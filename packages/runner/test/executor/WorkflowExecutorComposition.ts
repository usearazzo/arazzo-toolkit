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
  ResolverError,
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
 * Runs a promise expected to reject with a {@link ResolverError} — the shape
 * checks {@link OutputResolver.validateShape} throws, which are not an
 * {@link ExecutionError} like the executor's own authoring-error checks.
 */
const captureResolverError = async (promise: Promise<unknown>): Promise<ResolverError> => {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.instanceOf(caught, ResolverError);
  return caught as ResolverError;
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
    options: { maxSteps?: number; maxWorkflowDepth?: number; onCall?: () => void } = {},
  ): {
    executor: WorkflowExecutor;
    calls: OpenAPIOperationRequest[];
    sleeps: number[];
  } => {
    // `onCall` fires as each request is answered, which is how a test cancels a
    // run from the outside at a known point in it.
    const { onCall = (): void => {}, ...executorOptions } = options;
    const calls: OpenAPIOperationRequest[] = [];
    const sleeps: number[] = [];
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
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...executorOptions,
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

    specify(
      "should pass the calling workflow's parameters in as the child's inputs",
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('callsChildWithInheritedParameters');

        assert.strictEqual(result.status, 'completed');
        // the step declares no `petId` of its own, so the child was called with
        // the one it inherited from the workflow.
        assert.include(calls[0].url, '/pet/7');
        assert.strictEqual(result.outputs.childName, 'Rex');
        // and the step's own parameter still overrides the inherited one of the
        // same name — a workflowId step's parameters carry no `in`, so name
        // alone decides.
        assert.strictEqual(result.outputs.childPetId, '7');
        assert.strictEqual(result.outputs.childUnused, 'from-step');
      },
    );

    specify(
      "should let the step's own input beat an inherited parameter of the same name",
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('childInputBeatsInheritedParameter');

        assert.strictEqual(result.status, 'completed');
        // the two differ in `in`, so both survive the merge — but a step "can
        // never remove" what it inherits and must still override it. Were the
        // inherited one to win, the child would fetch pet 99.
        assert.strictEqual(result.outputs.childPetId, '7');
        assert.include(calls[0].url, '/pet/7');
      },
    );

    specify(
      'should key an inherited request-shaped parameter as an input by bare name',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('inheritedRequestParameterAsInput');

        assert.strictEqual(result.status, 'completed');
        // the inherited parameter carries `in: query`, but "all parameters map
        // to workflow inputs" for a workflowId step — so the child receives it
        // as the input `petId`, not under a `query.petId` key that would leave
        // `$inputs.petId` unresolved.
        assert.strictEqual(result.outputs.childPetId, '7');
        assert.include(calls[0].url, '/pet/7');
      },
    );

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

    specify("should apply the calling step's successCriteria to the sub-run", async function () {
      // the sub-workflow completes, but the step asserts the pet is named Fido
      // and it is Rex — the step fails, so its onFailure fires.
      const { executor } = makeExecutor();

      const result = await executor.execute('childCriteriaFail');

      assert.strictEqual(result.status, 'ended');
      assert.isFalse(result.steps[0].successful);
      // the sub-workflow itself ran fine; it is the step's assertion that failed.
      assert.strictEqual(subWorkflowsOf(result.steps[0])[0].status, 'completed');

      // the positive control: the same criterion, satisfied. Without it the case
      // above would also pass if the expression resolved to undefined, i.e. if
      // the criterion were evaluated against a context missing the sub-run.
      const passing = await makeExecutor().executor.execute('childCriteriaPass');
      assert.strictEqual(passing.status, 'completed');
      assert.isTrue(passing.steps[0].successful);
    });

    specify('should re-run a retried sub-workflow with the same inputs', async function () {
      // the calling step's parameter reads the sub-workflow's own outputs, which
      // the first attempt records — so resolving inputs per attempt would send a
      // different status the second time round.
      const { executor, calls } = makeExecutor(serverErrorResponse);

      const result = await executor.execute('retriesChildStableInputs');

      assert.strictEqual(result.steps[0].attempts, 2);
      assert.strictEqual(calls.length, 2);
      // each attempt echoes the input it ran with: both saw the inputs resolved
      // before the first attempt, so the retry did not pick up "sold" from the
      // outputs the first attempt recorded.
      assert.deepEqual(
        subWorkflowsOf(result.steps[0]).map((run) => run.outputs.echoed),
        [undefined, undefined],
      );
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

    specify(
      'should report a self-transfer as a cycle — the push-only stack keeps the transferring workflow on the chain',
      async function () {
        const { executor } = makeExecutor(okResponse, { maxWorkflowDepth: 1 });

        const error = await captureError(executor.execute('gotoSelf'));

        assert.strictEqual(error.reason, 'workflow-cycle');
        assert.deepEqual(error.path, ['gotoSelf', 'gotoSelf']);
      },
    );

    specify('should detect an indirect cycle formed through transfers', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('gotoCycleA'));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['gotoCycleA', 'gotoCycleB', 'gotoCycleA']);
    });

    specify(
      'should bound legitimate acyclic transfer chains by maxWorkflowDepth',
      async function () {
        const { executor } = makeExecutor(okResponse, { maxWorkflowDepth: 2 });

        const error = await captureError(executor.execute('gotoDeepOne'));

        assert.strictEqual(error.reason, 'workflow-depth');
      },
    );
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

    specify(
      "should not let a retry's workflowId reference clobber a dependency's recorded inputs",
      async function () {
        // echoInput is recorded once by dependsOn, with real inputs. doomed's
        // retry then references the same workflowId — its own reference has no
        // input channel and runs with {}, but that must refresh only the
        // recorded outputs, not erase the inputs the dependency actually ran
        // with.
        const { executor } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('retryReferenceDoesNotClobberDependencyInputs', {
          dependencyInputs: { echoInput: { seed: 'abc' } },
        });

        assert.strictEqual(result.status, 'failed');
        assert.strictEqual(result.outputs.seed, 'abc');
      },
    );

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
      // the failed prerequisite is still recorded, so the failing parent's own
      // outputs can read what it did resolve — uniform with a completed one.
      assert.strictEqual(result.outputs.fromFailed, 500);
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

    specify('should validate every prerequisite before running any', async function () {
      // the bad entry is second; the first must not have fired its requests by
      // the time the authoring error surfaces.
      const { executor, calls } = makeExecutor();

      const error = await captureError(executor.execute('dependsOnLateBadEntry'));

      assert.strictEqual(error.reason, 'source-description-not-arazzo');
      assert.strictEqual(calls.length, 0);
    });

    specify('should reject a prerequisite this document does not define', async function () {
      const { executor, calls } = makeExecutor();

      const error = await captureError(executor.execute('dependsOnLateUnknown'));

      assert.strictEqual(error.reason, 'workflow-not-found');
      assert.strictEqual(calls.length, 0);
    });

    specify('should not let runDependencies:false skip a sub-workflow’s own', async function () {
      // the caller vouches for what they named, not for prerequisites a
      // sub-workflow declares — those still run.
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('rootSkipsOwnDeps', { runDependencies: false });

      assert.strictEqual(result.status, 'completed');
      assert.isUndefined(result.dependencies);
      // setupA (the root's own) was skipped; setupB (the child's) ran, then the
      // child's own step.
      assert.strictEqual(calls.length, 2);
      assert.include(calls[0].url, '/pet/findByStatus');
      assert.include(calls[1].url, '/pet/7');
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

    specify(
      'should classify a cycle formed through a retry workflowId reference as a call cycle',
      async function () {
        // the parent's failing step retries by running refCycleChild, whose own
        // step calls back into the parent — grouped with 'step' for cycle
        // classification, not 'dependsOn', so this reports workflow-cycle.
        const { executor } = makeExecutor(serverErrorResponse);

        const error = await captureError(executor.execute('retryRefCycleParent'));

        assert.strictEqual(error.reason, 'workflow-cycle');
        assert.deepEqual(error.path, [
          'retryRefCycleParent',
          'refCycleChild',
          'retryRefCycleParent',
        ]);
      },
    );
  });

  context('transfer to a workflow (nested runs judged by settled status)', function () {
    specify(
      'should let a sub-workflow step take the success path when the target transfers to a completed chain',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('callsTransferringChild');

        assert.strictEqual(result.status, 'completed');
        assert.isTrue(result.steps[0].successful);
        const [subWorkflow] = subWorkflowsOf(result.steps[0]);
        assert.strictEqual(subWorkflow.status, 'transferred');
        assert.strictEqual(subWorkflow.settledStatus, 'completed');
        assert.strictEqual(subWorkflow.transferredTo?.workflowId, 'hasNameOutput');
        assert.strictEqual(subWorkflow.transferredTo?.status, 'completed');
        assert.strictEqual(subWorkflow.transferredTo?.outputs.name, 'Rex');
        // $workflows.childThatTransfers.outputs is {} — the transferred child's
        // own outputs declaration was never evaluated, so a step output mapped
        // from it resolves to nothing, even though the chain settled fine.
        assert.isUndefined(result.outputs.childOutputs);
        assert.strictEqual(calls.length, 2);
      },
    );

    specify(
      'should let a sub-workflow step take the failure path when the target transfers to a failed chain',
      async function () {
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('callsChildTransferringToFailing');

        assert.strictEqual(result.status, 'failed');
        assert.isFalse(result.steps[0].successful);
        const [subWorkflow] = subWorkflowsOf(result.steps[0]);
        assert.strictEqual(subWorkflow.status, 'transferred');
        assert.strictEqual(subWorkflow.settledStatus, 'failed');
        assert.strictEqual(subWorkflow.transferredTo?.status, 'failed');
        assert.strictEqual(calls.length, 2);
      },
    );

    specify(
      'should satisfy a dependent when its prerequisite transfers to a completed chain',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('dependsOnTransferringPrereq');

        assert.strictEqual(result.status, 'completed');
        const [dependency] = dependenciesOf(result);
        assert.strictEqual(dependency.status, 'transferred');
        assert.strictEqual(dependency.settledStatus, 'completed');
        assert.strictEqual(dependency.transferredTo?.status, 'completed');
        assert.strictEqual(calls.length, 3);
      },
    );

    specify(
      'should fail a dependent, running none of its own steps, when its prerequisite transfers to a failed chain',
      async function () {
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('dependsOnTransferringToFailingPrereq');

        assert.strictEqual(result.status, 'failed');
        assert.deepEqual(result.steps, []);
        const [dependency] = dependenciesOf(result);
        assert.strictEqual(dependency.status, 'transferred');
        assert.strictEqual(dependency.settledStatus, 'failed');
        assert.strictEqual(dependency.transferredTo?.status, 'failed');
        assert.strictEqual(calls.length, 2);
      },
    );

    specify(
      "should record a retry-workflowId reference as successful when its target's chain settles non-failed",
      async function () {
        // every client returns a 500, so doomed's own successCriteria never
        // pass — the retry (limit 1) fires the reference once and then
        // exhausts, falling to the break-default. Neither step in the
        // reference's own chain (jump, get) declares successCriteria, so
        // both succeed regardless of statusCode and the chain settles
        // 'completed' — a successful reference does not rescue doomed's own
        // outcome, the same as a failed one does not break its chain.
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('retryReferenceTransfers');

        assert.strictEqual(result.status, 'failed');
        assert.strictEqual(result.steps[0].attempts, 2);
        assert.strictEqual(result.steps[0].retryReferences?.length, 1);
        const reference = result.steps[0].retryReferences?.[0];
        assert.strictEqual(reference?.kind, 'workflow');
        assert.strictEqual(reference?.id, 'childThatTransfers');
        assert.isTrue(reference?.successful);
        assert.strictEqual(reference?.subWorkflow?.status, 'transferred');
        assert.strictEqual(reference?.subWorkflow?.settledStatus, 'completed');
        assert.strictEqual(reference?.subWorkflow?.transferredTo?.status, 'completed');
        assert.strictEqual(calls.length, 4);
      },
    );
  });

  context('cancellation across the call tree', function () {
    specify('should stop the prerequisite chain where the abort landed', async function () {
      // aborted while setupA's only request is in flight. setupA is the deepest
      // frame in progress, so its own closing boundary reports the run — naming
      // where the run *was*, not the setupB it was about to enter. Neither
      // setupB nor the dependent's own step runs.
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('dependent', { signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'setupA');
      // the chain, not just the leaf: the caller asked for `dependent`.
      assert.deepEqual(error.path, ['dependent', 'setupA']);
      assert.strictEqual(calls.length, 1);
    });

    specify('should stop a sub-workflow tree where the abort landed', async function () {
      // two steps call the same child; the abort lands during the first call.
      // The sub-run stops at its own closing boundary and the calling step names
      // it — `first`, the step that was in progress, not the `second` that never
      // began. The child runs once.
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('callsChildTwice', { signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'callsChildTwice');
      assert.strictEqual(error.stepId, 'first');
      assert.strictEqual(calls.length, 1);
    });
  });

  context('references into a non-Arazzo source', function () {
    specify('should throw for a sub-workflow step into an OpenAPI source', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('crossDocumentStep'));

      assert.strictEqual(error.reason, 'source-description-not-arazzo');
    });

    specify('should throw for a prerequisite into an OpenAPI source', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('crossDocumentDependsOn'));

      assert.strictEqual(error.reason, 'source-description-not-arazzo');
    });
  });

  context('authoring errors', function () {
    specify('should throw for a step naming both a workflow and an operation', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('ambiguousStep'));

      assert.strictEqual(error.reason, 'ambiguous-target');
    });

    specify('should reject malformed steps before running prerequisites', async function () {
      // the prerequisite would make live requests; an authoring error in the
      // workflow itself must be raised first.
      const { executor, calls } = makeExecutor();

      const error = await captureError(executor.execute('malformedStepsWithDependency'));

      assert.strictEqual(error.reason, 'malformed-steps');
      assert.strictEqual(calls.length, 0);
    });

    specify(
      'should reject malformed outputs before running prerequisites or steps',
      async function () {
        // both the prerequisite and the workflow's own step would make live
        // requests; a workflow that cannot possibly produce its outputs is
        // unrunnable from the start, so neither must fire.
        const { executor, calls } = makeExecutor();

        const error = await captureResolverError(
          executor.execute('malformedOutputsWithDependency'),
        );

        assert.strictEqual(error.reason, 'malformed-outputs');
        assert.strictEqual(error.workflowId, 'malformedOutputsWithDependency');
        assert.strictEqual(calls.length, 0);
      },
    );

    specify('should throw for a present but non-list "dependsOn"', async function () {
      const { executor } = makeExecutor();

      const error = await captureError(executor.execute('scalarDependsOn'));

      assert.strictEqual(error.reason, 'malformed-dependsOn');
    });
  });
});
