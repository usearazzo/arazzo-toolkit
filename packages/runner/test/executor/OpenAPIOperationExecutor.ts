import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  ArazzoDocument,
  OpenAPIOperationExecutor,
  OpenAPIOperationExtractor,
  OpenAPIOperationNormalizer,
  OpenAPIDocumentAssembler,
  OpenAPIOperationLocatorNormalizer,
  ExtractionError,
  ClientError,
  type HTTPClient,
  type OpenAPIOperationRequest,
  type OpenAPIOperationExecutorOptions,
  type OpenAPIOperationLocator,
  type OpenAPIDocument,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'petstore-order-workflow.arazzo.yaml');

/**
 * Creates a canned JSON response the stub transport resolves with.
 */
const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    ...init,
  });

/**
 * Builds an executor wired to a stub HTTPClient that records every request it
 * is asked to send and resolves with a canned response — deterministic, no
 * network.
 */
const makeExecutor = (
  options: Omit<OpenAPIOperationExecutorOptions, 'httpClient'> & {
    respond?: (request: OpenAPIOperationRequest) => Response | Promise<Response>;
  } = {},
): { executor: OpenAPIOperationExecutor; requests: OpenAPIOperationRequest[] } => {
  const { respond, ...executorOptions } = options;
  const requests: OpenAPIOperationRequest[] = [];
  const httpClient: HTTPClient = async (request) => {
    requests.push(request);
    return respond ? respond(request) : jsonResponse([{ id: 7 }]);
  };
  const executor = new OpenAPIOperationExecutor({ ...executorOptions, httpClient });
  return { executor, requests };
};

/**
 * Asserts a promise rejects with the given error type — a local stand-in for
 * chai-as-promised, which the package does not depend on. Returns the thrown
 * error for further assertions.
 */
const rejects = async (
  promise: Promise<unknown>,
  errorType?: typeof ExtractionError | typeof ClientError,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    if (errorType !== undefined) assert.instanceOf(error, errorType);
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

describe('OpenAPIOperationExecutor', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;
  let locatorNormalizer: OpenAPIOperationLocatorNormalizer;
  let locator: OpenAPIOperationLocator;

  before(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
    locatorNormalizer = new OpenAPIOperationLocatorNormalizer(registry);
    // resolve a real locator the same way the step executor does.
    locator = await locatorNormalizer.normalizeOperationId('findPetsByStatus', entry);
  });

  context('request building', function () {
    specify('should execute the located operation and return its response', async function () {
      const { executor, requests } = makeExecutor();

      const response = await executor.execute(locator, { parameters: { status: 'available' } });

      assert.strictEqual(response.status, 200);
      assert.isTrue(response.ok);
      assert.deepEqual(response.body, [{ id: 7 }]);
      assert.strictEqual(requests.length, 1);
    });

    specify('should build the request URL from the assembled operation', async function () {
      const { executor, requests } = makeExecutor();

      await executor.execute(locator, {
        parameters: { status: 'available' },
        contextUrl: 'https://petstore3.swagger.io',
      });

      assert.include(requests[0].url, 'https://petstore3.swagger.io/api/v3/pet/findByStatus');
      assert.strictEqual(requests[0].method, 'GET');
    });

    specify('should serialize parameters into the request', async function () {
      const { executor, requests } = makeExecutor();

      await executor.execute(locator, { parameters: { status: 'available' } });

      assert.include(requests[0].url, 'status=available');
    });

    specify('should serialize path parameters into the URL', async function () {
      const petLocator = await locatorNormalizer.normalizeOperationId('getPetById', entry);
      const { executor, requests } = makeExecutor();

      await executor.execute(petLocator, {
        parameters: { petId: 42 },
        contextUrl: 'https://petstore3.swagger.io',
      });

      assert.include(requests[0].url, 'https://petstore3.swagger.io/api/v3/pet/42');
    });

    specify('should select a server the document declares', async function () {
      const { executor, requests } = makeExecutor();

      // the fixture declares servers: [{ url: '/api/v3' }], so naming it
      // selects it and it resolves against the contextUrl as usual.
      await executor.execute(locator, {
        parameters: { status: 'available' },
        server: '/api/v3',
        contextUrl: 'https://petstore3.swagger.io',
      });

      assert.include(requests[0].url, 'https://petstore3.swagger.io/api/v3/pet/findByStatus');
    });

    specify(
      'should treat a server the document does not declare as an override',
      async function () {
        const { executor, requests } = makeExecutor();

        // no silent fallback to the first declared server: the URL named is the
        // URL called, replacing the declared base path along with the host.
        await executor.execute(locator, {
          parameters: { status: 'available' },
          server: 'https://staging.internal.test/api',
          contextUrl: 'https://petstore3.swagger.io',
        });

        assert.include(requests[0].url, 'https://staging.internal.test/api/pet/findByStatus');
        assert.notInclude(requests[0].url, 'petstore3.swagger.io');
        assert.notInclude(requests[0].url, '/api/v3');
      },
    );

    specify('should JSON-encode a plain-object request body', async function () {
      const orderLocator = await locatorNormalizer.normalizeOperationId('placeOrder', entry);
      const { executor, requests } = makeExecutor();

      await executor.execute(orderLocator, {
        requestBody: { petId: 42, quantity: 1 },
        requestContentType: 'application/json',
      });

      assert.strictEqual(requests[0].method, 'POST');
      // the plain-object body is JSON-encoded before it reaches the transport,
      // exactly as swagger-client's execute() does.
      assert.isString(requests[0].body);
      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 42, quantity: 1 });
    });

    specify('should match a media type carrying parameters on its base type', async function () {
      const orderLocator = await locatorNormalizer.normalizeOperationId('placeOrder', entry);
      const { executor, requests } = makeExecutor();

      // the operation declares `application/json`; swagger-client would match
      // that key exactly and drop both header and body for anything else.
      await executor.execute(orderLocator, {
        requestBody: { petId: 42, quantity: 1 },
        requestContentType: 'application/json; charset=utf-8',
      });

      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 42, quantity: 1 });
      // the authored media type survives, parameters included
      assert.strictEqual(requests[0].headers['Content-Type'], 'application/json; charset=utf-8');
    });

    specify('should match a media type regardless of case', async function () {
      const orderLocator = await locatorNormalizer.normalizeOperationId('placeOrder', entry);
      const { executor, requests } = makeExecutor();

      // media type names are case-insensitive, so this names the declared
      // `application/json` even though the spelling differs.
      await executor.execute(orderLocator, {
        requestBody: { petId: 42, quantity: 1 },
        requestContentType: 'Application/JSON',
      });

      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 42, quantity: 1 });
      assert.strictEqual(requests[0].headers['Content-Type'], 'Application/JSON');
    });

    specify('should throw when the operation declares no request body', async function () {
      // updatePetWithForm takes form parameters and declares no requestBody, so
      // there is no content to match and the payload would silently vanish.
      const formLocator = await locatorNormalizer.normalizeOperationId('updatePetWithForm', entry);
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(formLocator, {
          parameters: { petId: 42 },
          requestBody: { name: 'fido' },
          requestContentType: 'application/json',
        }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /declares no request body content/);
      // the way out is to drop the content type, so the error has to say so
      assert.match((thrown as ClientError).message, /Omit the content type/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should accept a declared media range covering the requested type', async function () {
      // `*/*` is what several generators emit by default; treating it as
      // undeclared would abort a workflow that previously worked.
      const rangeRegistry = new DocumentRegistry();
      const rangeDoc = (await rangeRegistry.acquire(
        path.join(fixturesPath, 'petstore.openapi-media-range.json'),
      )) as OpenAPIDocument;
      const rangeLocator = {
        document: rangeDoc,
        jsonPointer: rangeDoc.operationIndex.get('addPet'),
      } as OpenAPIOperationLocator;
      const { executor, requests } = makeExecutor();

      await executor.execute(rangeLocator, {
        requestBody: { name: 'fido' },
        requestContentType: 'application/json',
      });

      assert.deepEqual(JSON.parse(requests[0].body as string), { name: 'fido' });
      assert.strictEqual(requests[0].headers['Content-Type'], 'application/json');
    });

    specify('should refuse to match a form media type against a range', async function () {
      // buildRequest form-encodes the body only for an exactly declared form
      // type, so matching one against `*/*` would send JSON under a form header.
      const rangeRegistry = new DocumentRegistry();
      const rangeDoc = (await rangeRegistry.acquire(
        path.join(fixturesPath, 'petstore.openapi-media-range.json'),
      )) as OpenAPIDocument;
      const rangeLocator = {
        document: rangeDoc,
        jsonPointer: rangeDoc.operationIndex.get('addPet'),
      } as OpenAPIOperationLocator;
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(rangeLocator, {
          requestBody: { name: 'fido' },
          requestContentType: 'application/x-www-form-urlencoded',
        }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /must be declared by the operation exactly/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should not double the slash when a server ends with one', async function () {
      const { executor, requests } = makeExecutor();

      await executor.execute(locator, {
        parameters: { status: 'available' },
        server: 'https://staging.internal.test/api/',
      });

      assert.include(requests[0].url, 'https://staging.internal.test/api/pet/findByStatus');
      assert.notInclude(requests[0].url, '//pet');
    });

    specify('should throw ClientError for an undeclared media type', async function () {
      const orderLocator = await locatorNormalizer.normalizeOperationId('placeOrder', entry);
      const { executor, requests } = makeExecutor();

      // sending an empty body under a media type the operation never declared
      // is never what the author meant.
      const thrown = await rejects(
        executor.execute(orderLocator, {
          requestBody: { petId: 42 },
          requestContentType: 'application/vnd.custom+json',
        }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /is not declared by the operation/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should derive the operation target from the locator alone', async function () {
      const { executor, requests } = makeExecutor();

      // the operationId/operationPath passthroughs cannot hijack the operation:
      // the locator's JSON Pointer selects the operation in the assembled doc.
      await executor.execute(locator, {
        parameters: { status: 'available' },
        operationId: 'HIJACK',
        operationPath: '/paths/~1hijacked/get',
      });

      assert.include(requests[0].url, '/pet/findByStatus');
    });

    specify('should reject a locator whose pointer is not a JSON Pointer', async function () {
      const { executor, requests } = makeExecutor();
      const badLocator = { document: locator.document, jsonPointer: 'pet/findByStatus' };

      const thrown = await rejects(executor.execute(badLocator, {}), ClientError);

      assert.match((thrown as ClientError).message, /Invalid operationPath/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should reject a pointer that does not name an operation', async function () {
      // a valid JSON Pointer that addresses a response would otherwise resolve
      // to the operation's legacy id and silently execute it.
      const { executor, requests } = makeExecutor();
      const responseLocator = {
        document: locator.document,
        jsonPointer: '/paths/~1pet~1findByStatus/get/responses/200',
      };

      const thrown = await rejects(executor.execute(responseLocator, {}), ClientError);

      assert.match((thrown as ClientError).message, /must be of form/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should throw ClientError when the request cannot be built', async function () {
      const { executor, requests } = makeExecutor();

      // findPetsByStatus declares status as a required parameter — buildRequest
      // enforces it, and the failure surfaces as a ClientError before any
      // request is sent.
      const thrown = await rejects(executor.execute(locator), ClientError);
      assert.match(((thrown as ClientError).cause as Error).message, /Required parameter/);
      assert.strictEqual(requests.length, 0);
    });
  });

  context('pipeline', function () {
    specify('should propagate a synchronous extraction failure', async function () {
      const { executor, requests } = makeExecutor();

      // a locator pointing at no operation: extraction fails before any request
      // is built, and the error surfaces from execute.
      await rejects(
        executor.execute({ document: locator.document, jsonPointer: '/paths/~1nope/get' }),
        ExtractionError,
      );
      assert.strictEqual(requests.length, 0);
    });

    specify('should propagate an asynchronous normalization failure', async function () {
      const operationNormalizer = new OpenAPIOperationNormalizer();
      // the sole awaited pipeline collaborator: a rejection here must surface
      // from execute, and no request should be sent.
      operationNormalizer.normalize = async () => {
        throw new Error('normalize failed');
      };
      const { executor, requests } = makeExecutor({ operationNormalizer });

      await rejects(executor.execute(locator));
      assert.strictEqual(requests.length, 0);
    });

    specify(
      'should run the injected collaborators in extract → normalize → assemble → send order',
      async function () {
        const order: string[] = [];

        const operationExtractor = new OpenAPIOperationExtractor();
        const originalExtract = operationExtractor.extractByPointer.bind(operationExtractor);
        operationExtractor.extractByPointer = (document, pointer) => {
          order.push('extract');
          return originalExtract(document, pointer);
        };

        const operationNormalizer = new OpenAPIOperationNormalizer();
        const originalNormalize = operationNormalizer.normalize.bind(operationNormalizer);
        operationNormalizer.normalize = async (operation, document) => {
          order.push('normalize');
          return originalNormalize(operation, document);
        };

        const documentAssembler = new OpenAPIDocumentAssembler();
        const originalAssemble = documentAssembler.assemble.bind(documentAssembler);
        documentAssembler.assemble = (operation, document) => {
          order.push('assemble');
          return originalAssemble(operation, document);
        };

        const { executor } = makeExecutor({
          operationExtractor,
          operationNormalizer,
          documentAssembler,
          respond: () => {
            order.push('send');
            return jsonResponse([{ id: 7 }]);
          },
        });

        await executor.execute(locator, { parameters: { status: 'available' } });

        assert.deepEqual(order, ['extract', 'normalize', 'assemble', 'send']);
      },
    );
  });

  context('non-2xx and transport failures', function () {
    specify('should return a non-2xx response instead of throwing', async function () {
      // a non-2xx is a valid Arazzo outcome (judged by a step's successCriteria),
      // so it is returned as data rather than thrown.
      const { executor } = makeExecutor({
        respond: () =>
          jsonResponse({ message: 'boom' }, { status: 500, statusText: 'Internal Server Error' }),
      });

      const response = await executor.execute(locator, { parameters: { status: 'available' } });

      assert.strictEqual(response.status, 500);
      assert.isFalse(response.ok);
      assert.deepEqual(response.body, { message: 'boom' });
    });

    specify('should throw ClientError on a transport failure', async function () {
      const cause = new Error('network down');
      const { executor } = makeExecutor({
        respond: () => {
          throw cause;
        },
      });

      const thrown = await rejects(
        executor.execute(locator, { parameters: { status: 'available' } }),
        ClientError,
      );
      assert.strictEqual((thrown as ClientError).cause, cause);
    });
  });

  context('request interceptors and capture', function () {
    specify('should expose the sent request on the response', async function () {
      const { executor, requests } = makeExecutor();

      const response = await executor.execute(locator, {
        parameters: { status: 'available' },
        contextUrl: 'https://petstore3.swagger.io',
      });

      assert.isDefined(response.request);
      assert.strictEqual(response.request!.url, requests[0].url);
      assert.strictEqual(response.request!.method, 'GET');
      assert.strictEqual(response.url, requests[0].url);
    });

    specify('should capture the request even on a non-2xx response', async function () {
      const { executor } = makeExecutor({
        respond: () => jsonResponse('boom', { status: 500, statusText: 'Internal Server Error' }),
      });

      const response = await executor.execute(locator, { parameters: { status: 'available' } });

      assert.strictEqual(response.status, 500);
      assert.isDefined(response.request);
      assert.strictEqual(response.request!.method, 'GET');
    });

    specify(
      'should snapshot headers so a transport mutation cannot rewrite them',
      async function () {
        const { executor } = makeExecutor({
          respond: (request) => {
            // a transport that mutates the request after the capture point — the
            // recorded request must keep reflecting what was actually sent.
            request.headers['x-mutated'] = 'yes';
            return jsonResponse([{ id: 7 }]);
          },
        });

        const response = await executor.execute(locator, { parameters: { status: 'available' } });

        assert.notProperty(response.request!.headers, 'x-mutated');
      },
    );

    specify('should run the executor-level requestInterceptor on every request', async function () {
      const { executor, requests } = makeExecutor({
        requestInterceptor: (request) => {
          request.headers['x-trace'] = 'abc';
        },
      });

      const response = await executor.execute(locator, { parameters: { status: 'available' } });

      assert.strictEqual(requests[0].headers['x-trace'], 'abc');
      assert.strictEqual(response.request!.headers['x-trace'], 'abc');
    });

    specify(
      'should run the per-call requestInterceptor after the executor-level one',
      async function () {
        const order: string[] = [];
        const { executor, requests } = makeExecutor({
          requestInterceptor: (request) => {
            order.push('executor');
            request.headers['x-trace'] = 'executor';
          },
        });

        await executor.execute(locator, {
          parameters: { status: 'available' },
          requestInterceptor: (request) => {
            order.push('call');
            request.headers['x-trace'] = 'call';
          },
        });

        assert.deepEqual(order, ['executor', 'call']);
        assert.strictEqual(requests[0].headers['x-trace'], 'call');
      },
    );

    specify('should capture the edits of an async replacing interceptor', async function () {
      // an async interceptor that returns a replacement request — the captured
      // request must reflect the awaited result, not a pending promise.
      const { executor, requests } = makeExecutor();

      const response = await executor.execute(locator, {
        parameters: { status: 'available' },
        requestInterceptor: async (request) => ({
          ...request,
          headers: { ...request.headers, 'x-trace': 'abc' },
        }),
      });

      assert.strictEqual(requests[0].headers['x-trace'], 'abc');
      assert.strictEqual(response.request!.headers['x-trace'], 'abc');
    });

    specify('should thread an AbortSignal through to the transport', async function () {
      const controller = new AbortController();
      const { executor, requests } = makeExecutor();

      await executor.execute(locator, {
        parameters: { status: 'available' },
        signal: controller.signal,
      });

      assert.strictEqual(requests[0].signal, controller.signal);
    });
  });

  context('given a Swagger 2.0 source description', function () {
    let entry2: ArazzoDocument;
    let locatorNormalizer2: OpenAPIOperationLocatorNormalizer;

    before(async function () {
      const registry2 = new DocumentRegistry();
      entry2 = await registry2.acquireEntryDocument(
        path.join(fixturesPath, 'petstore-order-workflow-2-0.arazzo.yaml'),
      );
      locatorNormalizer2 = new OpenAPIOperationLocatorNormalizer(registry2);
    });

    specify('should send a request body as the declared body parameter', async function () {
      // Swagger 2.0 has no request body concept — the payload travels as the
      // operation's `in: body` parameter, whose name the executor looks up.
      const orderLocator = await locatorNormalizer2.normalizeOperationId('placeOrder', entry2);
      const { executor, requests } = makeExecutor();

      await executor.execute(orderLocator, {
        requestBody: { petId: 42, quantity: 1 },
        requestContentType: 'application/json',
      });

      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 42, quantity: 1 });
      // 2.0 declares no requestBody content to match against, so the content
      // type passes straight through to the header rather than being checked.
      assert.strictEqual(requests[0].headers['Content-Type'], 'application/json');
    });

    specify(
      'should spread a formData payload alongside qualified parameter keys',
      async function () {
        // the operation declares petId BOTH in path and in formData (legal —
        // uniqueness is (name, in)), with different values supplied to each.
        // The payload travels under qualified 'formData.{name}' keys next to
        // the caller's other '{in}.{name}' keys, so each petId reaches its own
        // place; the old bare spread would have captured the path parameter
        // and built /pet/7/form.
        const formLocator = await locatorNormalizer2.normalizeOperationId(
          'updatePetWithForm',
          entry2,
        );
        const { executor, requests } = makeExecutor();

        await executor.execute(formLocator, {
          parameters: { 'path.petId': 42, 'header.x-trace': 'abc' },
          requestBody: { name: 'Rex', status: 'sold', petId: 7 },
          requestContentType: 'application/x-www-form-urlencoded',
        });

        assert.include(requests[0].url, '/pet/42/form');
        assert.strictEqual(requests[0].headers['x-trace'], 'abc');
        // the payload keys matched the declared formData parameters and were
        // form-encoded into the body, the colliding name included.
        const body = new URLSearchParams(requests[0].body as string);
        assert.strictEqual(body.get('name'), 'Rex');
        assert.strictEqual(body.get('status'), 'sold');
        assert.strictEqual(body.get('petId'), '7');
      },
    );

    specify('should reject a bare caller entry that would displace the payload', async function () {
      // a bare `orderId` entry occupies the name the body payload is
      // delivered under; the client consults bare names first, so it would
      // silently displace the requestBody — reported instead of resolved
      // either way.
      const orderLocator = await locatorNormalizer2.normalizeOperationId('updateOrder', entry2);
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(orderLocator, {
          parameters: { orderId: 1, 'header.x-trace': 'abc' },
          requestBody: { petId: 7, quantity: 2 },
          requestContentType: 'application/json',
        }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /would displace the payload/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should reject a bare caller entry colliding with a formData field', async function () {
      const formLocator = await locatorNormalizer2.normalizeOperationId(
        'updatePetWithForm',
        entry2,
      );
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(formLocator, {
          parameters: { 'path.petId': 42, name: 'bare-entry' },
          requestBody: { name: 'Rex' },
          requestContentType: 'application/x-www-form-urlencoded',
        }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /would displace the payload/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should throw when the 2.0 operation declares no parameters at all', async function () {
      // an operation declaring none leaves `parameters` absent rather than
      // empty, which must still reach the "nothing can carry it" error.
      const bareRegistry = new DocumentRegistry();
      const bareDoc = (await bareRegistry.acquire(
        path.join(fixturesPath, 'petstore.openapi-2-0-no-schemes.json'),
      )) as OpenAPIDocument;
      const bareLocator = {
        document: bareDoc,
        jsonPointer: bareDoc.operationIndex.get('getInventory'),
      } as OpenAPIOperationLocator;
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(bareLocator, { requestBody: { a: 1 } }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /declares no "body" or "formData" parameter/);
      assert.strictEqual(requests.length, 0);
    });

    specify('should honor a server override, which 2.0 otherwise ignores', async function () {
      // swagger-client's Swagger 2.0 path builds its base URL from
      // schemes/host/basePath and ignores `server` entirely; routing an
      // unmatched value through baseURL makes it work here too.
      const orderLocator = await locatorNormalizer2.normalizeOperationId('placeOrder', entry2);
      const { executor, requests } = makeExecutor();

      await executor.execute(orderLocator, {
        requestBody: { petId: 42, quantity: 1 },
        requestContentType: 'application/json',
        server: 'https://staging.internal.test/v2',
      });

      assert.include(requests[0].url, 'https://staging.internal.test/v2/store/order');
      assert.notInclude(requests[0].url, 'petstore.swagger.io');
    });

    specify('should fall back to http for a document declaring no schemes', async function () {
      // Swagger 2.0 derives the scheme from the context URL when the document
      // declares none, so a locally loaded document must still yield an http
      // URL — never one carrying the scheme the document was loaded with.
      const fileRegistry = new DocumentRegistry();
      const openapiDoc = (await fileRegistry.acquire(
        path.join(fixturesPath, 'petstore.openapi-2-0-no-schemes.json'),
      )) as OpenAPIDocument;
      const fileLocator = {
        document: openapiDoc,
        jsonPointer: openapiDoc.operationIndex.get('getPetById'),
      } as OpenAPIOperationLocator;
      const { executor, requests } = makeExecutor();

      await executor.execute(fileLocator, { parameters: { petId: 42 } });

      assert.include(requests[0].url, 'http://petstore.swagger.io/v2/pet/42');
      assert.notInclude(requests[0].url, 'file:');
    });

    specify('should throw ClientError when no parameter can carry the body', async function () {
      // getPetById declares only a path parameter, so the payload has nowhere
      // to go — better a named failure than a request sent without its body.
      const petLocator = await locatorNormalizer2.normalizeOperationId('getPetById', entry2);
      const { executor, requests } = makeExecutor();

      const thrown = await rejects(
        executor.execute(petLocator, { parameters: { petId: 42 }, requestBody: { nope: true } }),
        ClientError,
      );

      assert.match((thrown as ClientError).message, /declares no "body" or "formData" parameter/);
      assert.strictEqual(requests.length, 0);
    });
  });
});
