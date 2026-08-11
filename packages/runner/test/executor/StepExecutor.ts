import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { refractStep, type StepElement } from '@speclynx/apidom-ns-arazzo-1';

import {
  DocumentRegistry,
  ArazzoDocument,
  StepExecutor,
  OpenAPIOperationExecutor,
  WorkflowExecutionState,
  ExecutionError,
  ClientError,
  type HTTPClient,
  type OpenAPIOperationRequest,
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

const okResponse = () => jsonResponse([{ id: 7 }]);
const notFoundResponse = () => jsonResponse({}, { status: 404, statusText: 'Not Found' });

/**
 * Asserts a promise rejects with the given error type and message — a local
 * stand-in for chai-as-promised, which the package does not depend on.
 */
const rejects = async (
  promise: Promise<unknown>,
  errorType?: typeof ExecutionError,
  message?: RegExp,
): Promise<void> => {
  try {
    await promise;
  } catch (error) {
    if (errorType !== undefined) assert.instanceOf(error, errorType);
    if (message !== undefined) assert.match((error as Error).message, message);
    return;
  }
  assert.fail('expected promise to reject, but it resolved');
};

describe('StepExecutor', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;

  before(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
    // the resolver acquires the source description on demand — no pre-load.
  });

  const makeExecutor = (
    respond: () => Response = okResponse,
  ): { executor: StepExecutor; requests: OpenAPIOperationRequest[] } => {
    const requests: OpenAPIOperationRequest[] = [];
    const httpClient: HTTPClient = async (request) => {
      requests.push(request);
      return respond();
    };
    const operationExecutor = new OpenAPIOperationExecutor({ httpClient });
    const executor = new StepExecutor({ document: entry, registry, operationExecutor });
    return { executor, requests };
  };

  const state = () => new WorkflowExecutionState({ inputs: { preferredPetStatus: 'available' } });

  context('operation resolution', function () {
    specify('should resolve a plain operationId and execute it', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: '$inputs.preferredPetStatus' }],
      }) as StepElement;
      const { executor, requests } = makeExecutor();

      const result = await executor.execute(step, state());

      assert.strictEqual(result.stepId, 'findPets');
      assert.strictEqual(result.response.status, 200);
      assert.strictEqual(requests.length, 1);
      // the resolved parameter reached the wire: the operation was located from
      // the plain operationId and the request built for it.
      assert.include(requests[0].url, '/pet/findByStatus');
      assert.include(requests[0].url, 'status=available');
      assert.strictEqual(requests[0].method, 'GET');
    });

    specify(
      'should resolve an operationId given as a $sourceDescriptions expression',
      async function () {
        const step = refractStep({
          stepId: 'findPets',
          operationId: '$sourceDescriptions.petstoreAPI.findPetsByStatus',
          parameters: [{ name: 'status', in: 'query', value: 'available' }],
        }) as StepElement;
        const { executor, requests } = makeExecutor();

        const result = await executor.execute(step, state());

        assert.strictEqual(result.response.status, 200);
        // the raw expression is normalized to the operation's location, not
        // forwarded verbatim.
        assert.include(requests[0].url, '/pet/findByStatus');
      },
    );

    specify('should resolve an operationPath and execute it', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationPath: '{$sourceDescriptions.petstoreAPI.url}#/paths/~1pet~1findByStatus/get',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
      }) as StepElement;
      const { executor, requests } = makeExecutor();

      const result = await executor.execute(step, state());

      assert.strictEqual(result.response.status, 200);
      assert.include(requests[0].url, '/pet/findByStatus');
    });

    specify('should throw for an operationId found in no source description', async function () {
      const step = refractStep({ stepId: 's', operationId: 'noSuchOperation' }) as StepElement;
      const { executor } = makeExecutor();

      await rejects(executor.execute(step, state()));
    });

    specify('should throw ExecutionError for a step with no operation target', async function () {
      const step = refractStep({ stepId: 's' }) as StepElement;
      const { executor } = makeExecutor();

      await rejects(
        executor.execute(step, state()),
        ExecutionError,
        /no operationId or operationPath/,
      );
    });

    specify('should throw ExecutionError for a workflowId step', async function () {
      const step = refractStep({ stepId: 's', workflowId: 'other' }) as StepElement;
      const { executor } = makeExecutor();

      await rejects(executor.execute(step, state()), ExecutionError, /workflow executor/);
    });

    specify('should throw ExecutionError when more than one target is declared', async function () {
      const step = refractStep({
        stepId: 's',
        operationId: 'findPetsByStatus',
        workflowId: 'other',
      }) as StepElement;
      const { executor } = makeExecutor();

      await rejects(executor.execute(step, state()), ExecutionError, /mutually exclusive/);
    });
  });

  context('outcome', function () {
    specify('should forward the resolved request body and content type', async function () {
      const step = refractStep({
        stepId: 'order',
        operationId: 'placeOrder',
        requestBody: { contentType: 'application/json', payload: { petId: 42, quantity: 1 } },
      }) as StepElement;
      const { executor, requests } = makeExecutor();

      await executor.execute(step, state());

      assert.strictEqual(requests[0].method, 'POST');
      // the resolved payload is built into the request and JSON-encoded before
      // it reaches the transport.
      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 42, quantity: 1 });
      assert.match(
        requests[0].headers['Content-Type'] ?? requests[0].headers['content-type'],
        /application\/json/,
      );
    });

    specify('should be successful when successCriteria pass', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        successCriteria: [{ condition: '$statusCode == 200' }],
        outputs: { pets: '$response.body', status: '$statusCode' },
      }) as StepElement;
      const { executor } = makeExecutor();

      const result = await executor.execute(step, state());

      assert.isTrue(result.successful);
      assert.deepEqual(result.outputs.pets, [{ id: 7 }]);
      assert.strictEqual(result.outputs.status, 200);
    });

    specify('should expose the sent request via $url / $method / $request', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        successCriteria: [{ condition: "$method == 'GET'" }],
        outputs: { calledUrl: '$url', verb: '$method', accept: '$request.header.accept' },
      }) as StepElement;
      const { executor, requests } = makeExecutor();

      const result = await executor.execute(step, state());

      assert.isTrue(result.successful);
      // the outputs reflect the request that was actually built and sent.
      assert.strictEqual(result.outputs.calledUrl, requests[0].url);
      assert.include(result.outputs.calledUrl as string, 'status=available');
      assert.strictEqual(result.outputs.verb, 'GET');
      // buildRequest derives the accept header from the operation's response
      // media types.
      assert.include(result.outputs.accept as string, 'application/json');
    });

    specify('should not be successful when a successCriterion fails', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        successCriteria: [{ condition: '$statusCode == 200' }],
      }) as StepElement;
      const { executor } = makeExecutor(notFoundResponse);

      const result = await executor.execute(step, state());

      assert.isFalse(result.successful);
    });

    specify('should select the onFailure action on the failure path', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        successCriteria: [{ condition: '$statusCode == 200' }],
        onFailure: [{ name: 'retry', type: 'retry', retryAfter: 1, retryLimit: 3 }],
      }) as StepElement;
      const { executor } = makeExecutor(notFoundResponse);

      const result = await executor.execute(step, state());

      assert.isFalse(result.successful);
      assert.isDefined(result.action);
    });

    specify(
      'should pass through execute options with Arazzo values taking precedence',
      async function () {
        const step = refractStep({
          stepId: 'findPets',
          operationId: 'findPetsByStatus',
          parameters: [{ name: 'status', in: 'query', value: 'available' }],
        }) as StepElement;
        const { executor, requests } = makeExecutor();

        await executor.execute(step, state(), {
          contextUrl: 'https://example.com',
          operationId: 'HIJACK',
          operationPath: '/paths/~1hijacked/get',
        });

        // the opaque contextUrl passthrough shaped the request URL, while the
        // Arazzo-derived operation target won: the operationId/operationPath
        // passthroughs could not hijack the operation.
        assert.include(requests[0].url, 'https://example.com');
        assert.include(requests[0].url, '/pet/findByStatus');
      },
    );
  });

  context('cancellation', function () {
    specify(
      'should throw aborted rather than send an already-cancelled request',
      async function () {
        const step = refractStep({
          stepId: 'findPets',
          operationId: 'findPetsByStatus',
          parameters: [{ name: 'status', in: 'query', value: 'available' }],
        }) as StepElement;
        const { executor, requests } = makeExecutor();
        const controller = new AbortController();
        controller.abort();

        await rejects(
          executor.execute(step, state(), { signal: controller.signal }),
          ExecutionError,
          /run aborted before step "findPets"/,
        );
        // nothing reached the transport: an aborted signal must not become a
        // cancelled request judged like a refusal from the API.
        assert.strictEqual(requests.length, 0);
      },
    );

    specify('should report a request cancelled in flight as the abort', async function () {
      // what a real transport does: fetch and axios both reject the request they
      // were told to drop. The operation executor wraps that as a ClientError —
      // the shape for a request that failed on its own terms — which would make
      // a mid-flight cancellation read differently from one between two steps.
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
      }) as StepElement;
      const controller = new AbortController();
      const requests: OpenAPIOperationRequest[] = [];
      const httpClient: HTTPClient = async (request) => {
        requests.push(request);
        controller.abort();
        throw new DOMException('This operation was aborted', 'AbortError');
      };
      const executor = new StepExecutor({
        document: entry,
        registry,
        operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
      });

      await rejects(
        executor.execute(step, state(), { signal: controller.signal }),
        ExecutionError,
        /run aborted before step "findPets"/,
      );
      // the request did go out — this is the in-flight case, not the pre-dispatch one.
      assert.strictEqual(requests.length, 1);
    });

    specify('should still report a genuine transport failure as one', async function () {
      // the same rejection without a cancellation stays a ClientError: only an
      // aborted signal reinterprets it.
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
      }) as StepElement;
      const controller = new AbortController();
      const httpClient: HTTPClient = async () => {
        throw new Error('ECONNREFUSED');
      };
      const executor = new StepExecutor({
        document: entry,
        registry,
        operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
      });

      let caught: unknown;
      try {
        await executor.execute(step, state(), { signal: controller.signal });
      } catch (error) {
        caught = error;
      }

      assert.instanceOf(caught, ClientError);
    });

    specify('should forward a live signal to the request it builds', async function () {
      const step = refractStep({
        stepId: 'findPets',
        operationId: 'findPetsByStatus',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
      }) as StepElement;
      const { executor, requests } = makeExecutor();
      const controller = new AbortController();

      const result = await executor.execute(step, state(), { signal: controller.signal });

      // a signal that has not fired changes nothing but still reaches the wire,
      // so the transport can cancel the request in flight.
      assert.isTrue(result.successful);
      assert.strictEqual(requests[0].signal, controller.signal);
    });
  });

  context('given a Swagger 2.0 source description', function () {
    specify("should send a step's request body to a 2.0 operation", async function () {
      // Arazzo expresses a payload only as `requestBody` — its parameter `in`
      // has no `body` value — so a step against a Swagger 2.0 source
      // description reaches the wire only if the operation executor routes the
      // payload to the declared body parameter.
      const registry2 = new DocumentRegistry();
      const entry2 = await registry2.acquireEntryDocument(
        path.join(fixturesPath, 'petstore-order-workflow-2-0.arazzo.yaml'),
      );
      const requests: OpenAPIOperationRequest[] = [];
      const httpClient: HTTPClient = async (request) => {
        requests.push(request);
        return okResponse();
      };
      const executor = new StepExecutor({
        document: entry2,
        registry: registry2,
        operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
      });

      const step = refractStep({
        stepId: 'placeOrder',
        operationId: 'placeOrder',
        requestBody: { contentType: 'application/json', payload: { petId: 7, quantity: 1 } },
      }) as StepElement;

      const result = await executor.execute(step, new WorkflowExecutionState({ inputs: {} }));

      assert.isTrue(result.successful);
      assert.deepEqual(JSON.parse(requests[0].body as string), { petId: 7, quantity: 1 });
    });
  });
});
