import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ClientError,
  DocumentRegistry,
  OpenAPIDocument,
  OpenAPIOperationExecutor,
  Redactor,
  type HTTPClient,
  type OpenAPIOperationEvent,
  type OpenAPIOperationExecutorOptions,
  type OpenAPIOperationRequestSettledEvent,
  type OpenAPIOperationRequestStartEvent,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');

describe('OpenAPIOperationExecutor events', function () {
  let registry: DocumentRegistry;
  let petstore: OpenAPIDocument;
  let queryKey: OpenAPIDocument;

  before(async function () {
    registry = new DocumentRegistry();
    const acquire = async (file: string): Promise<OpenAPIDocument> => {
      const document = await registry.acquire(path.join(fixturesPath, file));
      assert.isTrue(OpenAPIDocument.is(document));
      return document as OpenAPIDocument;
    };
    petstore = await acquire('petstore.openapi.json');
    queryKey = await acquire('api-key-query.openapi.json');
  });

  const httpClient: HTTPClient = async () =>
    new Response(JSON.stringify({ id: 7, token: 'RESPONSE-TOKEN' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'session=abc' },
    });

  const observe = (
    options: OpenAPIOperationExecutorOptions = {},
  ): { executor: OpenAPIOperationExecutor; events: OpenAPIOperationEvent[] } => {
    const events: OpenAPIOperationEvent[] = [];
    const executor = new OpenAPIOperationExecutor({
      httpClient,
      ...options,
      observer: (event) => events.push(event),
    });
    return { executor, events };
  };

  const startOf = (events: OpenAPIOperationEvent[]): OpenAPIOperationRequestStartEvent =>
    events.find(
      (event): event is OpenAPIOperationRequestStartEvent =>
        event.type === 'openapi-operation-request-start',
    ) as OpenAPIOperationRequestStartEvent;
  const settledOf = (events: OpenAPIOperationEvent[]): OpenAPIOperationRequestSettledEvent =>
    events.find(
      (event): event is OpenAPIOperationRequestSettledEvent =>
        event.type === 'openapi-operation-request-settled',
    ) as OpenAPIOperationRequestSettledEvent;

  const getPet = { jsonPointer: '/paths/~1pet~1{petId}/get' };

  specify('should report the request sent and the response received', async function () {
    let time = 0;
    const { executor, events } = observe({ now: () => (time += 1) });

    await executor.execute(
      { document: petstore, ...getPet },
      { parameters: { petId: 7 }, step: { stepId: 'getPet' }, runId: 'run-1' },
    );

    const start = startOf(events);
    const settled = settledOf(events);
    assert.strictEqual(start.request.method, 'GET');
    assert.match(start.request.url, /\/pet\/7$/);
    assert.deepEqual(start.step, { stepId: 'getPet' });
    assert.strictEqual(start.runId, 'run-1');
    assert.strictEqual(settled.response.status, 200);
    assert.strictEqual(settled.response.headers['content-type'], 'application/json');
    assert.isAbove(settled.timestamp, start.timestamp);
    // bodies come only with captureBodies
    assert.notProperty(start.request, 'body');
    assert.notProperty(settled.response, 'body');
  });

  specify('should carry the exchange as it was, for a Redactor to mask', async function () {
    const { executor, events } = observe({
      requestInterceptor: (request) => {
        request.headers.Authorization = 'Bearer token-from-interceptor';
        return request;
      },
    });

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    const start = startOf(events);
    assert.strictEqual(start.request.headers.Authorization, 'Bearer token-from-interceptor');
    const redactor = new Redactor();
    assert.strictEqual(redactor.event(start).request.headers.Authorization, 'REDACTED');
    assert.strictEqual(
      redactor.event(settledOf(events)).response.headers['set-cookie'],
      'REDACTED',
    );
  });

  specify("should list where the document's security schemes put credentials", async function () {
    const { executor, events } = observe();

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    // petstore declares an oauth2 scheme and an apiKey header named api_key.
    assert.sameMembers([...startOf(events).credentials], ['Authorization', 'api_key']);
  });

  specify('should let a Redactor mask scheme credentials whatever its patterns', async function () {
    const redactor = new Redactor({ fields: [] });
    const header = observe();
    const query = observe();

    // deletePet declares api_key as a header parameter the step sends itself.
    await header.executor.execute(
      { document: petstore, jsonPointer: '/paths/~1pet~1{petId}/delete' },
      { parameters: { petId: 7, api_key: 'STEP-KEY' } },
    );
    await query.executor.execute(
      { document: queryKey, jsonPointer: '/paths/~1items/get' },
      { parameters: { page: '2' }, securities: { authorized: { queryKey: 'QUERY-KEY' } } },
    );

    assert.strictEqual(redactor.event(startOf(header.events)).request.headers.api_key, 'REDACTED');
    const { url } = redactor.event(startOf(query.events)).request;
    assert.include(url, 'key=REDACTED');
    assert.include(url, 'page=2');
  });

  specify('should read a security scheme given as a local $ref', async function () {
    const { executor, events } = observe();

    await executor.execute(
      { document: queryKey, jsonPointer: '/paths/~1items/get' },
      { parameters: { page: '2' } },
    );

    assert.sameMembers([...startOf(events).credentials], ['key', 'X-Partner']);
  });

  specify('should carry a body that is not UTF-8 as its size only', async function () {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x01]);
    const { executor, events } = observe({
      captureBodies: true,
      httpClient: async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
    });

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    assert.deepEqual(settledOf(events).response.body, { size: 4 });
  });

  specify('should carry a request body an interceptor set as a value', async function () {
    const { executor, events } = observe({
      captureBodies: true,
      requestInterceptor: (request) => {
        request.body = new URLSearchParams({ grant_type: 'password', password: 'p' });
        return request;
      },
    });

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    assert.strictEqual(startOf(events).request.body?.text, 'grant_type=password&password=p');
  });

  specify('should carry the bodies with captureBodies', async function () {
    const { executor, events } = observe({ captureBodies: true });

    await executor.execute(
      { document: petstore, jsonPointer: '/paths/~1pet/post' },
      { requestBody: { name: 'Rex', password: 'hunter2' }, requestContentType: 'application/json' },
    );

    const start = startOf(events);
    const settled = settledOf(events);
    assert.include(start.request.body?.text, 'hunter2');
    assert.include(settled.response.body?.text, 'RESPONSE-TOKEN');
    assert.isAbove(settled.response.body?.size ?? 0, 0);
    const redactor = new Redactor();
    assert.notInclude(redactor.event(start).request.body?.text, 'hunter2');
    assert.notInclude(redactor.event(settled).response.body?.text, 'RESPONSE-TOKEN');
  });

  specify('should leave a request that fails in the transport unsettled', async function () {
    const { executor, events } = observe({
      httpClient: async () => {
        throw new TypeError('network down');
      },
    });

    let caught: unknown;
    try {
      await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });
    } catch (error) {
      caught = error;
    }

    assert.instanceOf(caught, ClientError);
    assert.strictEqual(events.at(-1)?.type, 'openapi-operation-request-start');
  });
});
