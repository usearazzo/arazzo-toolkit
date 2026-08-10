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
  type WorkflowExecutionResult,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'workflow-composition.arazzo.yaml');

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
 * The dependency runs recorded on a result, asserting there were some.
 */
const dependenciesOf = (result: WorkflowExecutionResult): readonly WorkflowExecutionResult[] => {
  assert.isDefined(result.dependencies);
  return result.dependencies as readonly WorkflowExecutionResult[];
};

describe('WorkflowExecutor composition', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;

  before(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
  });

  /**
   * Builds a workflow executor whose stub transport answers every request with
   * `response`, recording the sent requests as `calls` and the delays its (no-op)
   * retry timer was asked to wait as `sleeps`.
   */
  const makeExecutor = (
    response: CannedResponse = okResponse,
    options: { maxSteps?: number; maxWorkflowDepth?: number } = {},
  ): {
    executor: WorkflowExecutor;
    calls: OpenAPIOperationRequest[];
    sleeps: number[];
  } => {
    const calls: OpenAPIOperationRequest[] = [];
    const sleeps: number[] = [];
    const httpClient: HTTPClient = async (request) => {
      calls.push(request);
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
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...options,
    });
    return { executor, calls, sleeps };
  };

  context('sub-workflow steps', function () {
    specify('should run the sub-workflow and map inputs in and outputs out', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('callsChild');

      assert.strictEqual(result.status, 'completed');
      // the step's parameters became the sub-workflow's inputs, so the child
      // requested the pet the parent named.
      assert.strictEqual(calls.length, 2);
      assert.include(calls[0].url, '/pet/7');
      // the child's outputs are readable both by the calling step and by the
      // parent workflow, through $workflows.
      assert.strictEqual(result.outputs.childName, 'Rex');
      assert.strictEqual(result.outputs.viaWorkflows, 'Rex');
      // control returned to the parent: the following step ran.
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['child', 'after'],
      );
      assert.strictEqual(result.outputs.afterRan, 200);
    });

    specify("should nest the sub-run's own trace under the calling step", async function () {
      const { executor } = makeExecutor();

      const result = await executor.execute('callsChild');

      const [subRun] = subWorkflowsOf(result.steps[0]);
      assert.strictEqual(subRun.workflowId, 'fetchPet');
      assert.strictEqual(subRun.status, 'completed');
      assert.deepEqual(
        subRun.steps.map((step) => step.stepId),
        ['get'],
      );
      assert.deepEqual(subRun.outputs, { name: 'Rex' });
      // a plain operation step carries no nested run.
      assert.isUndefined(result.steps[1].subWorkflows);
    });

    specify('should keep two calls of the same sub-workflow distinct', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('callsChildTwice');

      assert.strictEqual(result.status, 'completed');
      // each call ran with its own inputs...
      assert.include(calls[0].url, '/pet/7');
      assert.include(calls[1].url, '/pet/8');
      // ...and each produced its own trace, neither overwriting the other.
      const [first] = subWorkflowsOf(result.steps[0]);
      const [second] = subWorkflowsOf(result.steps[1]);
      assert.notStrictEqual(first, second);
      assert.strictEqual(first.workflowId, 'fetchPet');
      assert.strictEqual(second.workflowId, 'fetchPet');
    });

    specify('should take the failure path when the sub-workflow fails', async function () {
      // every response is a 500, so the child's criteria never pass.
      const { executor, calls, sleeps } = makeExecutor(serverErrorResponse);

      const result = await executor.execute('retriesChild');

      assert.strictEqual(result.status, 'failed');
      assert.isFalse(result.steps[0].successful);
      // the retry re-ran the whole child: initial + 2 retries.
      assert.strictEqual(result.steps[0].attempts, 3);
      assert.strictEqual(calls.length, 3);
      assert.deepEqual(sleeps, [1000, 1000]);
      // one nested run per attempt — no attempt's trace is lost.
      assert.strictEqual(subWorkflowsOf(result.steps[0]).length, 3);
    });

    specify('should charge sub-workflow attempts to the one shared budget', async function () {
      // three workflows one step deep: a per-invocation budget of 2 would let
      // this pass, a shared one must not.
      const { executor } = makeExecutor(okResponse, { maxSteps: 2 });

      const error = await captureError(executor.execute('deepOne'));

      assert.strictEqual(error.reason, 'step-budget');
      // the error names the whole chain, not just the innocent leaf that
      // happened to spend the last unit.
      assert.deepEqual(error.path, ['deepOne', 'deepTwo', 'deepThree']);
    });
  });

  context('cycles and nesting depth', function () {
    specify('should report a direct self-call as a cycle, not as depth', async function () {
      // the depth ceiling is low enough that it would also trip here; the cycle
      // check runs first so the cause reported is the real one.
      const { executor } = makeExecutor(okResponse, { maxWorkflowDepth: 1 });

      const error = await captureError(executor.execute('selfCycle'));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['selfCycle', 'selfCycle']);
    });

    specify('should detect an indirect cycle through sub-workflow steps', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('cycleA'));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['cycleA', 'cycleB', 'cycleA']);
    });

    specify('should not mistake a diamond for a cycle', async function () {
      // the shared workflow is reached twice, but each visit completes and
      // unwinds before the next begins.
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('diamondTop');

      assert.strictEqual(result.status, 'completed');
      // a step call is a call: the shared workflow ran on both paths.
      assert.strictEqual(calls.length, 2);
    });

    specify('should bound legitimate acyclic nesting by maxWorkflowDepth', async function () {
      const { executor } = makeExecutor(okResponse, { maxWorkflowDepth: 2 });

      const error = await captureError(executor.execute('deepOne'));

      assert.strictEqual(error.reason, 'workflow-depth');
    });

    specify('should allow nesting up to the depth limit', async function () {
      const { executor, calls } = makeExecutor(okResponse, { maxWorkflowDepth: 3 });

      const result = await executor.execute('deepOne');

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls.length, 1);
    });
  });

  context('dependsOn', function () {
    specify('should run prerequisites to completion, in order, first', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('dependent');

      assert.strictEqual(result.status, 'completed');
      // setupA, then setupB, then the workflow's own step.
      assert.strictEqual(calls.length, 3);
      assert.include(calls[0].url, '/store/inventory');
      assert.include(calls[1].url, '/pet/findByStatus');
      assert.include(calls[2].url, '/pet/7');
      assert.deepEqual(
        dependenciesOf(result).map((dependency) => dependency.workflowId),
        ['setupA', 'setupB'],
      );
      // the trace holds only this workflow's own steps.
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['own'],
      );
    });

    specify("should expose a prerequisite's outputs through $workflows", async function () {
      const { executor } = makeExecutor();

      const result = await executor.execute('dependent');

      assert.strictEqual(result.outputs.fromSetupA, 200);
      assert.strictEqual(result.outputs.own, 200);
    });

    specify('should feed a prerequisite from dependencyInputs', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('dependsOnNeedsInput', {
        dependencyInputs: { needsInput: { petId: '42' } },
      });

      assert.strictEqual(result.status, 'completed');
      assert.include(calls[0].url, '/pet/42');
    });

    specify('should feed a transitive prerequisite from the same map', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('transitiveOuter', {
        dependencyInputs: { needsInput: { petId: '42' } },
      });

      assert.strictEqual(result.status, 'completed');
      // the deepest prerequisite ran first, with its caller-supplied inputs.
      assert.include(calls[0].url, '/pet/42');
      const [middle] = dependenciesOf(result);
      assert.strictEqual(middle.workflowId, 'transitiveMiddle');
      assert.strictEqual(dependenciesOf(middle)[0].workflowId, 'needsInput');
    });

    specify('should satisfy a shared prerequisite once, not run it twice', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('depDiamondTop');

      assert.strictEqual(result.status, 'completed');
      // setupA once + left + right + top = 4; a re-run would make it 5.
      assert.strictEqual(calls.length, 4);
      const [left, right] = dependenciesOf(result);
      // both dependents report the same single run.
      assert.strictEqual(dependenciesOf(left)[0], dependenciesOf(right)[0]);
    });

    specify('should fail the workflow when a prerequisite fails', async function () {
      const { executor, calls } = makeExecutor(serverErrorResponse);

      const result = await executor.execute('dependsOnFailing');

      assert.strictEqual(result.status, 'failed');
      // none of its own steps ran.
      assert.deepEqual(result.steps, []);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(dependenciesOf(result)[0].status, 'failed');
    });

    specify('should skip prerequisites when runDependencies is false', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('dependent', { runDependencies: false });

      assert.strictEqual(result.status, 'completed');
      // only the workflow's own step ran...
      assert.strictEqual(calls.length, 1);
      assert.include(calls[0].url, '/pet/7');
      assert.isUndefined(result.dependencies);
      // ...so nothing populated $workflows for the skipped prerequisite.
      assert.isUndefined(result.outputs.fromSetupA);
    });

    specify('should detect a cycle formed purely by dependsOn edges', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('depCycleA'));

      assert.strictEqual(error.reason, 'dependsOn-cycle');
      assert.deepEqual(error.path, ['depCycleA', 'depCycleB', 'depCycleA']);
    });

    specify('should detect a cycle crossing dependsOn and step calls', async function () {
      // A dependsOn B, and B has a step calling A — one shared call stack sees
      // the loop that neither mechanism would catch alone.
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('crossA'));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['crossA', 'crossB', 'crossA']);
    });
  });

  context('not yet supported', function () {
    specify('should throw for a sub-workflow step in another document', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('crossDocumentStep'));

      assert.strictEqual(error.reason, 'cross-document-workflow-unsupported');
    });

    specify('should throw for a prerequisite in another document', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('crossDocumentDependsOn'));

      assert.strictEqual(error.reason, 'cross-document-workflow-unsupported');
    });
  });

  context('authoring errors', function () {
    specify('should throw for a step naming both a workflow and an operation', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('ambiguousStep'));

      assert.strictEqual(error.reason, 'ambiguous-target');
    });

    specify('should throw for a present but non-list "dependsOn"', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('scalarDependsOn'));

      assert.strictEqual(error.reason, 'malformed-dependsOn');
    });
  });
});
