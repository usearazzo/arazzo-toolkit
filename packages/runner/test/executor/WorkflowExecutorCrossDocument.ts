import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  ArazzoDocument,
  WorkflowExecutor,
  StepExecutor,
  OpenAPIOperationExecutor,
  ExecutionError,
  type HTTPClient,
  type OpenAPIOperationRequest,
  type StepRunRecord,
  type RetryReferenceRecord,
  type WorkflowExecutionResult,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'cross-document.arazzo.yaml');

/**
 * A canned response recipe the stub transport materializes into a fresh WHATWG
 * Response per call (a Response body is single-use, so each call needs its own).
 */
type CannedResponse = { status: number; statusText: string; body: unknown };

const okResponse: CannedResponse = {
  status: 200,
  statusText: 'OK',
  body: { id: 7, name: 'Rex' },
};
const serverErrorResponse: CannedResponse = {
  status: 500,
  statusText: 'Internal Server Error',
  body: {},
};

/**
 * Runs a promise expected to reject and returns the ExecutionError it rejected
 * with, so a test can assert on its `reason` and `path` rather than only its
 * message.
 */
const captureError = async (promise: Promise<unknown>): Promise<ExecutionError> => {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.instanceOf(caught, ExecutionError);
  return caught as ExecutionError;
};

/**
 * The sub-workflow runs recorded on a step, asserting there were some — narrows
 * away the optionality of a field only sub-workflow steps carry.
 */
const subWorkflowsOf = (step: StepRunRecord): readonly WorkflowExecutionResult[] => {
  assert.isDefined(step.subWorkflows);
  return step.subWorkflows as readonly WorkflowExecutionResult[];
};

/**
 * The retry reference runs recorded on a step, asserting there were some.
 */
const retryReferencesOf = (step: StepRunRecord): readonly RetryReferenceRecord[] => {
  assert.isDefined(step.retryReferences);
  return step.retryReferences as readonly RetryReferenceRecord[];
};

/**
 * The dependency runs recorded on a result, asserting there were some.
 */
const dependenciesOf = (result: WorkflowExecutionResult): readonly WorkflowExecutionResult[] => {
  assert.isDefined(result.dependencies);
  return result.dependencies as readonly WorkflowExecutionResult[];
};

describe('WorkflowExecutor cross-document references', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;

  before(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
  });

  /**
   * Builds a workflow executor whose stub transport answers every request with
   * `response`, recording the sent requests as `calls`. The entry and the child
   * documents' APIs have distinct server prefixes (`/api/v3` vs
   * `/child-api/v1`), so a recorded URL proves which document's source
   * descriptions an operation was resolved against.
   */
  const makeExecutor = (
    response: CannedResponse = okResponse,
    options: { maxSteps?: number; maxWorkflowDepth?: number; onCall?: () => void } = {},
  ): {
    executor: WorkflowExecutor;
    calls: OpenAPIOperationRequest[];
  } => {
    // `onCall` fires as each request is answered, which is how a test cancels a
    // run from the outside at a known point in it.
    const { onCall = (): void => {}, ...executorOptions } = options;
    const calls: OpenAPIOperationRequest[] = [];
    const httpClient: HTTPClient = async (request) => {
      calls.push(request);
      onCall();
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        statusText: response.statusText,
        headers: { 'content-type': 'application/json' },
      });
    };
    const executor = new WorkflowExecutor({
      document: entry,
      registry,
      stepExecutor: new StepExecutor({
        document: entry,
        registry,
        operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
      }),
      sleep: async () => {},
      ...executorOptions,
    });
    return { executor, calls };
  };

  context('sub-workflow step across documents', function () {
    specify(
      'should run the foreign workflow against its own document and map inputs and outputs',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('crossDocumentStep');

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(calls.length, 2);
        // the foreign step's plain operationId resolved against the CHILD
        // document's petstoreAPI — the child API's server prefix proves it —
        // and the parent's own following step against the entry document's.
        assert.include(calls[0].url, '/child-api/v1/pet/7');
        assert.include(calls[1].url, '/api/v3/store/inventory');
        // the child's outputs are readable by the calling step and the parent
        // workflow through $workflows.{bare id}.
        assert.strictEqual(result.outputs.childName, 'Rex');
        assert.strictEqual(result.outputs.afterRan, 200);
        // a $sourceDescriptions expression inside the foreign workflow
        // resolved against the foreign document's own sources.
        assert.match(result.outputs.childSource as string, /cross-document-child\.openapi\.json$/);
        // the nested run is recorded under the bare foreign workflowId.
        assert.strictEqual(subWorkflowsOf(result.steps[0])[0].workflowId, 'childFetch');
      },
    );

    specify(
      'should resolve a plain reference made from a foreign workflow within the foreign document',
      async function () {
        const { executor } = makeExecutor();

        // deepEntry -> childCallsShared (foreign) -> shared, a plain id that
        // exists in BOTH documents; made from the foreign workflow, it must
        // resolve to the child's.
        const result = await executor.execute('deepEntry');

        assert.strictEqual(result.status, 'completed');
        assert.match(result.outputs.source as string, /cross-document-child\.openapi\.json$/);
      },
    );

    specify('should not mistake two documents sharing a workflowId for a cycle', async function () {
      const { executor } = makeExecutor();

      // the entry `shared` calls the child's `shared` — the bare ids
      // collide on one call chain, the qualified identities do not.
      const result = await executor.execute('shared');

      assert.strictEqual(result.status, 'completed');
      assert.match(result.outputs.source as string, /cross-document-child\.openapi\.json$/);
    });

    specify(
      'should record same-named workflows of two documents under one bare $workflows key, last write winning',
      async function () {
        const { executor } = makeExecutor();

        // step `foreign` records the child's `shared`; step `local` then
        // records the entry's own under the same bare key. `origin` exists
        // only on the entry's outputs, so its presence proves the later
        // write won — the documented last-write-wins hazard.
        const result = await executor.execute('collisionCaller');

        assert.strictEqual(result.status, 'completed');
        assert.match(result.outputs.winnerOrigin as string, /petstore\.openapi\.json$/);
      },
    );

    specify("should forward executeOptions to a foreign workflow's steps", async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('crossDocumentStep', {
        executeOptions: { server: 'https://override.example/base' },
      });

      assert.strictEqual(result.status, 'completed');
      // the server override reached the foreign document's step as well as
      // the entry document's own.
      assert.include(calls[0].url, 'https://override.example/base');
      assert.include(calls[0].url, '/pet/7');
      assert.include(calls[1].url, 'https://override.example/base');
    });
  });

  context('dependsOn across documents', function () {
    specify(
      'should run the foreign prerequisite with inputs keyed by the reference as written',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('crossDocumentDependsOn', {
          dependencyInputs: {
            '$sourceDescriptions.childWorkflows.childSetup': { token: 'from-caller' },
          },
        });

        assert.strictEqual(result.status, 'completed');
        // the prerequisite ran first, against the child document's API.
        assert.strictEqual(calls.length, 2);
        assert.include(calls[0].url, '/child-api/v1/store/inventory');
        assert.include(calls[1].url, '/api/v3/store/inventory');
        // the dependencyInputs entry — keyed by the literal reference —
        // reached the foreign prerequisite, and its outputs read back through
        // the bare id.
        assert.strictEqual(result.outputs.setupEcho, 'from-caller');
        assert.strictEqual(result.outputs.ownRan, 200);
        assert.strictEqual(dependenciesOf(result)[0].workflowId, 'childSetup');
      },
    );

    specify(
      'should satisfy a diamond onto a foreign prerequisite from its one memoized run',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('diamondLeft');

        assert.strictEqual(result.status, 'completed');
        // childSetup once (for diamondLeft; memoized for diamondRight under
        // its document-qualified identity) + diamondRight's own step.
        assert.strictEqual(calls.length, 2);
        assert.include(calls[0].url, '/child-api/v1/store/inventory');
        // both dependents still report the one run.
        assert.strictEqual(dependenciesOf(result)[0].workflowId, 'childSetup');
        const nested = subWorkflowsOf(result.steps[0])[0];
        assert.strictEqual(dependenciesOf(nested)[0].workflowId, 'childSetup');
      },
    );

    specify(
      'should validate every dependsOn entry against its document before any prerequisite runs',
      async function () {
        const { executor, calls } = makeExecutor();

        const error = await captureError(executor.execute('dependsOnUnknownForeign'));

        assert.strictEqual(error.reason, 'workflow-not-found');
        assert.strictEqual(error.workflowId, 'dependsOnUnknownForeign');
        // the message names the document the workflow is actually missing from.
        assert.match(error.message, /cross-document-child\.arazzo\.yaml/);
        // found before anything fired.
        assert.strictEqual(calls.length, 0);
      },
    );

    specify(
      "should give a memoized prerequisite's record the inputs the run actually received",
      async function () {
        const { executor, calls } = makeExecutor();

        // the entry depends on the child's childSetup by expression; the
        // child workflow it then calls depends on the same prerequisite by
        // its local bare id — one qualified identity, two spellings.
        const result = await executor.execute('mixedInputsDiamond', {
          dependencyInputs: {
            '$sourceDescriptions.childWorkflows.childSetup': { token: 'first' },
          },
        });

        assert.strictEqual(result.status, 'completed');
        // childSetup ran once; the bare-id spelling was satisfied from the
        // memoized run.
        assert.strictEqual(calls.length, 2);
        // the second dependent reads the inputs the memoized run actually
        // received — not the (absent) dependencyInputs entry for its own
        // bare-id spelling.
        assert.strictEqual(result.outputs.setupToken, 'first');
      },
    );
  });

  context('retry reference across documents', function () {
    specify('should run the foreign reference before each retry attempt', async function () {
      const { executor, calls } = makeExecutor(serverErrorResponse);

      const result = await executor.execute('crossDocumentRetryReference');

      // the step fails, the reference repairs (against the child document's
      // API), the one granted retry fails again.
      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(calls.length, 3);
      assert.include(calls[0].url, '/api/v3/store/inventory');
      assert.include(calls[1].url, '/child-api/v1/store/inventory');
      assert.include(calls[2].url, '/api/v3/store/inventory');

      const step = result.steps[0];
      assert.strictEqual(step.attempts, 2);
      const reference = retryReferencesOf(step)[0];
      assert.strictEqual(reference.kind, 'workflow');
      // the record carries the reference as written.
      assert.strictEqual(reference.id, '$sourceDescriptions.childWorkflows.childRepair');
      assert.isTrue(reference.successful);
      assert.strictEqual(reference.subWorkflow?.workflowId, 'childRepair');
      assert.strictEqual(reference.subWorkflow?.outputs.refreshed, 500);
    });

    specify(
      'should run a retry stepId reference inside a foreign workflow against its own document',
      async function () {
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('crossDocumentRetryStepInside');

        assert.strictEqual(result.status, 'failed');
        // doomed, the helper reference, doomed again — all against the
        // child document's API.
        assert.strictEqual(calls.length, 3);
        calls.forEach((call) => assert.include(call.url, '/child-api/v1/store/inventory'));
        const nested = subWorkflowsOf(result.steps[0])[0];
        assert.strictEqual(nested.workflowId, 'childRetryStep');
        const nestedStep = nested.steps[0];
        assert.strictEqual(nestedStep.attempts, 2);
        const reference = retryReferencesOf(nestedStep)[0];
        assert.strictEqual(reference.kind, 'step');
        assert.strictEqual(reference.id, 'helper');
      },
    );
  });

  context('goto transfer across documents', function () {
    specify('should transfer one-way into the foreign workflow', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('crossDocumentGoto');

      assert.strictEqual(result.status, 'transferred');
      assert.strictEqual(result.settledStatus, 'completed');
      assert.deepEqual(result.outputs, {});
      assert.strictEqual(result.transferredTo?.workflowId, 'childFinal');
      assert.strictEqual(result.transferredTo?.outputs.done, 200);
      // the target ran against the child document's API.
      assert.strictEqual(calls.length, 2);
      assert.include(calls[1].url, '/child-api/v1/store/inventory');
    });

    specify(
      "should run a foreign transfer target's own dependsOn before its steps",
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('crossDocumentGotoWithDeps');

        assert.strictEqual(result.status, 'transferred');
        const target = result.transferredTo as WorkflowExecutionResult;
        assert.strictEqual(target.workflowId, 'childFinalWithSetup');
        assert.strictEqual(dependenciesOf(target)[0].workflowId, 'childSetup');
        assert.strictEqual(target.outputs.done, 200);
        // the caller's own step, then the target's prerequisite and step —
        // the latter two against the child document's API.
        assert.strictEqual(calls.length, 3);
        assert.include(calls[0].url, '/api/v3/store/inventory');
        assert.include(calls[1].url, '/child-api/v1/store/inventory');
        assert.include(calls[2].url, '/child-api/v1/store/inventory');
      },
    );

    specify(
      'should report an abort at the transfer boundary as aborted, not resolve the target',
      async function () {
        // same boundary convention the same-document transfer keeps: the
        // abort check precedes the reference's resolution, so a cancelled run
        // reports why it stopped rather than anything about a target it never
        // got to resolve.
        const controller = new AbortController();
        const { executor, calls } = makeExecutor(okResponse, {
          onCall: () => controller.abort(),
        });

        const error = await captureError(
          executor.execute('crossDocumentGoto', { signal: controller.signal }),
        );

        assert.strictEqual(error.reason, 'aborted');
        assert.strictEqual(calls.length, 1);
      },
    );
  });

  context('cycles and depth across documents', function () {
    specify('should detect a cycle closed across the document boundary', async function () {
      const { executor } = makeExecutor();

      // loopEntry -> (child) callsBack -> loopEntry again, via the child's
      // `parent` source description.
      const error = await captureError(executor.execute('loopEntry'));

      assert.strictEqual(error.reason, 'workflow-cycle');
      const errorPath = error.path as readonly string[];
      assert.lengthOf(errorPath, 3);
      // entry-document frames display as the bare id, foreign frames as
      // {documentURI}#{workflowId}.
      assert.strictEqual(errorPath[0], 'loopEntry');
      assert.match(errorPath[1], /cross-document-child\.arazzo\.yaml#callsBack$/);
      assert.strictEqual(errorPath[2], 'loopEntry');
    });

    specify('should bound nesting depth across documents', async function () {
      const { executor } = makeExecutor(okResponse, { maxWorkflowDepth: 2 });

      // deepEntry (1) -> childCallsShared (2) -> shared (3) exceeds 2.
      const error = await captureError(executor.execute('deepEntry'));

      assert.strictEqual(error.reason, 'workflow-depth');
      const errorPath = error.path as readonly string[];
      assert.lengthOf(errorPath, 3);
      assert.match(errorPath[2], /cross-document-child\.arazzo\.yaml#shared$/);
    });
  });

  context('reference errors', function () {
    specify(
      'should throw for a source description the document does not define',
      async function () {
        const { executor } = makeExecutor();

        const error = await captureError(executor.execute('unknownSource'));

        assert.strictEqual(error.reason, 'source-description-not-found');
        assert.strictEqual(error.workflowId, 'unknownSource');
        assert.strictEqual(error.stepId, 'only');
        assert.match(error.message, /noSuchSource/);
      },
    );

    specify('should throw for a workflow the foreign document does not define', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('unknownForeignWorkflow'));

      assert.strictEqual(error.reason, 'workflow-not-found');
      assert.strictEqual(error.workflowId, 'noSuchWorkflow');
      // the message names the document searched — the child, not the entry.
      assert.match(error.message, /cross-document-child\.arazzo\.yaml/);
    });

    specify(
      'should reject a $-prefixed reference that is not a $sourceDescriptions expression',
      async function () {
        const { executor, calls } = makeExecutor();

        const error = await captureError(executor.execute('invalidReference'));

        assert.strictEqual(error.reason, 'invalid-workflow-reference');
        assert.strictEqual(error.stepId, 'only');
        // rejected synchronously, before any request fired.
        assert.strictEqual(calls.length, 0);
      },
    );

    specify(
      "should reject the resolver's JSON-Pointer reference form — not a runtime expression",
      async function () {
        const { executor } = makeExecutor();

        const error = await captureError(executor.execute('pointerReference'));

        assert.strictEqual(error.reason, 'invalid-workflow-reference');
      },
    );
  });
});
