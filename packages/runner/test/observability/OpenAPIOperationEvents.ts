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

  specify('should carry the bodies with captureBodies', async function () {
    const { executor, events } = observe({ captureBodies: true });

    await executor.execute(
      { document: petstore, jsonPointer: '/paths/~1pet/post' },
      { requestBody: { name: 'Rex', password: 'hunter2' }, requestContentType: 'application/json' },
    );

    const start = startOf(events);
    const settled = settledOf(events);
    // the request body as sent, the response body as parsed
    assert.include(start.request.body as string, 'hunter2');
    assert.deepEqual(settled.response.body, { id: 7, token: 'RESPONSE-TOKEN' });
    const redactor = new Redactor();
    assert.notInclude(redactor.event(start).request.body as string, 'hunter2');
    assert.deepEqual(redactor.event(settled).response.body, { id: 7, token: 'REDACTED' });
  });

  specify('should let a Redactor mask an apiKey in the query', async function () {
    const { executor, events } = observe();

    await executor.execute(
      { document: queryKey, jsonPointer: '/paths/~1items/get' },
      { parameters: { page: '2' }, securities: { authorized: { queryKey: 'QUERY-KEY' } } },
    );

    const { url } = new Redactor().event(startOf(events)).request;
    assert.include(url, 'key=REDACTED');
    assert.include(url, 'page=2');
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
