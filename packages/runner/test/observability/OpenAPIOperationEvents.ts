import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ClientError,
  DocumentRegistry,
  OpenAPIDocument,
  OpenAPIOperationExecutor,
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
    new Response(JSON.stringify({ id: 7 }), {
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

  const requestOf = (
    events: OpenAPIOperationEvent[],
  ): OpenAPIOperationRequestStartEvent['request'] =>
    (
      events.find(
        (event) => event.type === 'openapi-operation-request-start',
      ) as OpenAPIOperationRequestStartEvent
    ).request;

  const getPet = { jsonPointer: '/paths/~1pet~1{petId}/get' };

  specify('should report the request sent and the response that came back', async function () {
    let time = 0;
    const { executor, events } = observe({ now: () => (time += 1) });

    await executor.execute(
      { document: petstore, ...getPet },
      { parameters: { petId: 7 }, step: { stepId: 'getPet' }, runId: 'run-1' },
    );

    const start = events.find(
      (event): event is OpenAPIOperationRequestStartEvent =>
        event.type === 'openapi-operation-request-start',
    );
    const settled = events.find(
      (event): event is OpenAPIOperationRequestSettledEvent =>
        event.type === 'openapi-operation-request-settled',
    );
    assert.strictEqual(start?.request.method, 'GET');
    assert.match(start?.request.url ?? '', /\/pet\/7$/);
    assert.deepEqual(start?.step, { stepId: 'getPet' });
    assert.strictEqual(start?.runId, 'run-1');
    assert.strictEqual(settled?.response.status, 200);
    assert.strictEqual(settled?.response.headers['content-type'], 'application/json');
    assert.isAbove(settled?.timestamp ?? 0, start?.timestamp ?? 0);
    // bodies are never carried
    assert.notProperty(start?.request, 'body');
    assert.notProperty(settled?.response, 'body');
  });

  specify('should mask credential headers on both sides', async function () {
    const { executor, events } = observe({
      requestInterceptor: (request) => {
        request.headers.Authorization = 'Bearer token-from-interceptor';
        request.headers['X-Trace'] = 'visible';
        return request;
      },
    });

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    const { headers } = requestOf(events);
    assert.strictEqual(headers.Authorization, 'REDACTED');
    assert.strictEqual(headers['X-Trace'], 'visible');
    const settled = events.find(
      (event): event is OpenAPIOperationRequestSettledEvent =>
        event.type === 'openapi-operation-request-settled',
    );
    assert.strictEqual(settled?.response.headers['set-cookie'], 'REDACTED');
  });

  specify('should always mask an apiKey header the request applies', async function () {
    // an empty list removes every default, yet the scheme's own header stays masked
    const { executor, events } = observe({ redact: { headers: [] } });

    await executor.execute(
      { document: petstore, ...getPet },
      { parameters: { petId: 7 }, securities: { authorized: { api_key: 'PETS-KEY' } } },
    );

    assert.strictEqual(requestOf(events).headers.api_key, 'REDACTED');
  });

  specify('should always mask the Authorization header a scheme applies', async function () {
    const { executor, events } = observe({ redact: { headers: [] } });

    await executor.execute(
      { document: petstore, jsonPointer: '/paths/~1pet~1findByStatus/get' },
      {
        parameters: { status: 'available' },
        securities: {
          authorized: { petstore_auth: { token: { access_token: 'OAUTH-TOKEN' } } },
        },
      },
    );

    const { headers } = requestOf(events);
    assert.strictEqual(headers.Authorization, 'REDACTED');
  });

  specify('should always mask an apiKey query parameter the request applies', async function () {
    const { executor, events } = observe();

    await executor.execute(
      { document: queryKey, jsonPointer: '/paths/~1items/get' },
      { parameters: { page: '2' }, securities: { authorized: { queryKey: 'QUERY-KEY' } } },
    );

    const { url } = requestOf(events);
    assert.include(url, 'key=REDACTED');
    assert.include(url, 'page=2');
    assert.notInclude(url, 'QUERY-KEY');
  });

  specify('should mask the headers a redact list names', async function () {
    const { executor, events } = observe({
      redact: { headers: [...OpenAPIOperationExecutor.defaultRedact.headers, 'x-session'] },
      requestInterceptor: (request) => {
        request.headers['X-Session'] = 'secret';
        request.headers.Authorization = 'Bearer secret';
        return request;
      },
    });

    await executor.execute({ document: petstore, ...getPet }, { parameters: { petId: 7 } });

    const { headers } = requestOf(events);
    assert.strictEqual(headers['X-Session'], 'REDACTED');
    assert.strictEqual(headers.Authorization, 'REDACTED');
  });

  specify('should leave a request that fails in the transport unsettled', async function () {
    const events: OpenAPIOperationEvent[] = [];
    const executor = new OpenAPIOperationExecutor({
      httpClient: async () => {
        throw new TypeError('network down');
      },
      observer: (event) => events.push(event),
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
