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
  settledResult,
  type HTTPClient,
  type OpenAPIOperationRequest,
  type WorkflowExecuteOptions,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'workflow-control-flow.arazzo.yaml');

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
const serviceUnavailableResponse: CannedResponse = {
  status: 503,
  statusText: 'Service Unavailable',
  body: {},
};

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

/**
 * Runs a promise expected to reject and returns the ExecutionError it rejected
 * with, so a test can assert on its structured fields (`reason`, `path`) rather
 * than only its message.
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

describe('WorkflowExecutor', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;

  before(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
  });

  /**
   * Builds a step executor whose stub transport returns `sequence` responses in
   * order, recording the sent requests (in execution order) into `calls`.
   * Call N gets `sequence[N]`; once the list is exhausted every further call
   * repeats the last entry, so a single-element sequence is a constant response
   * and a longer one drives "fails twice, then succeeds".
   */
  const makeStepExecutor = (
    sequence: readonly CannedResponse[],
    calls: OpenAPIOperationRequest[],
    onCall: () => void = () => {},
  ): StepExecutor => {
    const httpClient: HTTPClient = async (request) => {
      const canned = sequence[Math.min(calls.length, sequence.length - 1)];
      calls.push(request);
      onCall();
      return new Response(JSON.stringify(canned.body), {
        status: canned.status,
        statusText: canned.statusText,
        headers: { 'content-type': 'application/json' },
      });
    };
    return new StepExecutor({
      document: entry,
      registry,
      operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
    });
  };

  /**
   * Builds a workflow executor whose transport returns `responses` in sequence,
   * exposing the recorded requests as `calls` and the `sleeps` its (no-op) retry
   * timer was asked to wait — so retry behavior is deterministic and `retryAfter`
   * timing is assertable without real waiting. A single response is a constant;
   * a longer sequence drives retry ("fails twice, then succeeds").
   */
  const makeExecutor = (
    responses: CannedResponse | readonly CannedResponse[] = okResponse,
    options: { maxSteps?: number; tickMs?: number; onCall?: () => void } = {},
  ): {
    executor: WorkflowExecutor;
    calls: OpenAPIOperationRequest[];
    sleeps: number[];
  } => {
    // `onCall` fires as each request is answered, which is how a test cancels a
    // run from the outside at a known point in it.
    const { tickMs = 0, onCall = (): void => {}, ...executorOptions } = options;
    const sequence = Array.isArray(responses) ? responses : [responses as CannedResponse];
    const calls: OpenAPIOperationRequest[] = [];
    const sleeps: number[] = [];
    // a fake clock the stub transport advances by `tickMs` per request, so
    // durations are exactly the work done rather than real elapsed time.
    let time = 0;
    const executor = new WorkflowExecutor({
      document: entry,
      registry,
      stepExecutor: makeStepExecutor(sequence, calls, () => {
        time += tickMs;
        onCall();
      }),
      sleep: async (ms) => {
        sleeps.push(ms);
        // the fake timer advances the fake clock, so a duration that includes a
        // retry wait is distinguishable from one that excludes it.
        time += ms;
      },
      now: () => time,
      ...executorOptions,
    });
    return { executor, calls, sleeps };
  };

  context('linear flow', function () {
    specify('should run steps in list order and flow outputs step to step', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(result.workflowId, 'linear');
      assert.strictEqual(result.status, 'completed');
      // both steps ran, in order.
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['findPets', 'getPet'],
      );
      assert.isTrue(result.steps.every((step) => step.successful));
      // getPet's petId parameter came from findPets' resolved output and was
      // serialized into the second request's URL.
      assert.strictEqual(calls.length, 2);
      assert.include(calls[1].url, '/pet/7');
      // workflow outputs resolved against the final state.
      assert.deepEqual(result.outputs, { name: 'Rex', id: 7 });
    });

    specify('should complete a workflow with no steps as a no-op', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('emptyWorkflow');

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(result.steps, []);
      assert.strictEqual(calls.length, 0);
      assert.deepEqual(result.outputs, {});
    });
  });

  context('timing', function () {
    specify('should record the elapsed time of the run and of each step', async function () {
      // the fake clock advances 100ms per request, so a two-step run is 100ms
      // per step and 200ms overall.
      const { executor } = makeExecutor(okResponse, { tickMs: 100 });

      const result = await executor.execute('linear', { inputs: { status: 'available' } });

      assert.deepEqual(
        result.steps.map((step) => step.durationMs),
        [100, 100],
      );
      assert.strictEqual(result.durationMs, 200);
    });

    specify('should cover every attempt of a retried step, waits included', async function () {
      // fails twice then succeeds: 3 requests at 100ms plus the two 2s retryAfter
      // waits, all charged to the one step record.
      const { executor, sleeps } = makeExecutor(
        [serverErrorResponse, serverErrorResponse, okResponse],
        { tickMs: 100 },
      );

      const result = await executor.execute('retryThenSucceed');

      assert.strictEqual(result.steps[0].attempts, 3);
      // the waits are the bulk of it — excluding them would leave just 300.
      assert.deepEqual(sleeps, [2000, 2000]);
      assert.strictEqual(result.steps[0].durationMs, 4300);
      assert.strictEqual(result.durationMs, 4300);
    });
  });

  context('goto', function () {
    specify('should jump to the target step, skipping steps in between', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('gotoStep');

      assert.strictEqual(result.status, 'completed');
      // first gotos third; second is skipped entirely.
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['first', 'third'],
      );
      assert.strictEqual(calls.length, 2);
      assert.isUndefined(result.outputs.secondRan);
      assert.strictEqual(result.outputs.thirdReached, 200);
    });

    specify('should throw goto-target-not-found for an unknown target step', async function () {
      const { executor } = makeExecutor();

      await rejects(
        executor.execute('gotoMissing'),
        ExecutionError,
        /goto target step "nonexistent"/,
      );
    });

    specify('should bound an infinite goto by the step budget', async function () {
      const { executor } = makeExecutor(okResponse, { maxSteps: 5 });

      await rejects(executor.execute('infiniteGoto'), ExecutionError, /budget of 5 step attempts/);
    });
  });

  context('stop conditions', function () {
    specify('should stop early on an end action with status "ended"', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('endEarly');

      assert.strictEqual(result.status, 'ended');
      // only the first step ran; the end action stopped the run.
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['first'],
      );
      assert.strictEqual(calls.length, 1);
      // outputs so far are returned; the un-run step's output is absent.
      assert.strictEqual(result.outputs.first, 200);
      assert.isUndefined(result.outputs.second);
    });

    specify(
      'should break with status "failed" when a step fails and has no onFailure',
      async function () {
        // every client returns a 500, so the first step's successCriteria fail.
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('failBreak');

        assert.strictEqual(result.status, 'failed');
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['doomed'],
        );
        assert.isFalse(result.steps[0].successful);
        // the second step never executed.
        assert.strictEqual(calls.length, 1);
        assert.isUndefined(result.outputs.neverRan);
      },
    );
  });

  context('workflow-level parameters', function () {
    specify('should apply them per step, each step overriding for itself', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('inheritsParameters', {
        inputs: { status: 'available' },
      });

      assert.strictEqual(result.status, 'completed');
      // the first step declares no `status` and runs with the inherited one; the
      // second declares its own, which wins for itself and only for itself.
      assert.include(calls[0].url, 'status=available');
      assert.include(calls[1].url, 'status=sold');
      assert.notInclude(calls[1].url, 'status=available');
    });

    specify('should resolve an inherited expression against each step state', async function () {
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('parameterResolvedPerStep');

      assert.strictEqual(result.status, 'completed');
      // the workflow-level `petId` reads $steps.findPets.outputs.petId, which
      // only has a value once the first step has run — so it is resolved as each
      // step is entered, not once for the workflow.
      assert.include(calls[1].url, '/pet/7');
    });
  });

  context('workflow-level default actions', function () {
    specify(
      'should apply workflow failureActions to a step that declares no onFailure',
      async function () {
        // the step fails (500) and has no onFailure, so it inherits the
        // workflow-level failureActions (end); the run ends, not breaks.
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('inheritsFailureActions');

        assert.strictEqual(result.status, 'ended');
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['only'],
        );
        // the inherited end action was selected for the failing step.
        assert.strictEqual(calls.length, 1);
      },
    );

    specify(
      "should let a step's own onFailure override the workflow failureActions wholesale",
      async function () {
        // the step fails (500) but its own onFailure gotos a recovery step; the
        // workflow-level end is not applied.
        const { executor, calls } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('overridesFailureActions');

        assert.strictEqual(result.status, 'completed');
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['failing', 'recovery'],
        );
        assert.strictEqual(calls.length, 2);
      },
    );

    specify(
      'should apply workflow successActions to a step that declares no onSuccess',
      async function () {
        // the first step succeeds and, having no onSuccess, inherits the
        // workflow-level successActions (end); the second step never runs.
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('inheritsSuccessActions');

        assert.strictEqual(result.status, 'ended');
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['first'],
        );
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(result.outputs.first, 200);
        assert.isUndefined(result.outputs.second);
      },
    );

    specify(
      'should let an empty step onSuccess suppress the workflow successActions',
      async function () {
        // the first step declares onSuccess: [] — an explicit empty list, not an
        // absent one — which overrides the workflow "end" wholesale. The run must
        // proceed to the second step rather than ending early.
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('emptyOnSuccessSuppressesDefault');

        assert.strictEqual(result.status, 'completed');
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['first', 'second'],
        );
        assert.strictEqual(calls.length, 2);
        assert.strictEqual(result.outputs.second, 200);
      },
    );

    specify('should fall back to success and failure defaults independently', async function () {
      // the step overrides onSuccess (goto third) but declares no onFailure. On
      // success its own goto wins — skipping the second step — while the
      // workflow-level failureActions remain available but unused here.
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('overrideSuccessInheritFailure');

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['first', 'third'],
      );
      assert.strictEqual(calls.length, 2);
      assert.isUndefined(result.outputs.second);
      assert.strictEqual(result.outputs.third, 200);
    });

    specify('should give each step inheriting one retry action its own budget', async function () {
      // 500, 200, 500, 200 — each step fails once and recovers within its own
      // retryLimit of 1. Both steps inherit the same retry action *instance*,
      // and a retry budget is keyed by that instance, so a shared budget would
      // leave the second step's retry already exhausted and break the run.
      const { executor, calls } = makeExecutor([
        serverErrorResponse,
        okResponse,
        serverErrorResponse,
        okResponse,
      ]);

      const result = await executor.execute('inheritedRetryPerStepBudget');

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(
        result.steps.map((step) => step.attempts),
        [2, 2],
      );
      assert.strictEqual(calls.length, 4);
      assert.strictEqual(result.outputs.second, 200);
    });
  });

  context('malformed control flow', function () {
    specify(
      'should throw for a goto action naming neither stepId nor workflowId',
      async function () {
        const { executor } = makeExecutor();

        await rejects(
          executor.execute('gotoNoTarget'),
          ExecutionError,
          /has neither stepId nor workflowId/,
        );
      },
    );

    specify('should throw for an action with an unknown type', async function () {
      const { executor } = makeExecutor();

      await rejects(
        executor.execute('unknownActionType'),
        ExecutionError,
        /has unsupported type "teleport"/,
      );
    });

    specify('should throw for a present but non-list "steps"', async function () {
      // a malformed steps is an authoring error, not a silent no-op run.
      const { executor } = makeExecutor();

      await rejects(executor.execute('scalarSteps'), ExecutionError, /non-list "steps"/);
    });
  });

  context('retry', function () {
    specify('should retry a failing step until it succeeds', async function () {
      // fails twice (500), then succeeds (200) — within a retryLimit of 3.
      const { executor, calls, sleeps } = makeExecutor([
        serverErrorResponse,
        serverErrorResponse,
        okResponse,
      ]);

      const result = await executor.execute('retryThenSucceed');

      assert.strictEqual(result.status, 'completed');
      // 3 attempts: initial + 2 retries.
      assert.strictEqual(calls.length, 3);
      assert.strictEqual(result.steps[0].attempts, 3);
      assert.isTrue(result.steps[0].successful);
      // slept before each of the 2 retries, retryAfter: 2s → 2000ms.
      assert.deepEqual(sleeps, [2000, 2000]);
      assert.strictEqual(result.outputs.status, 200);
    });

    specify('should default retryLimit to 1 when unset, without sleeping', async function () {
      // getInventory always 500; retry has no retryLimit → a single retry, and
      // no retryAfter → no sleep (not even a sleep(0) event-loop yield).
      const { executor, calls, sleeps } = makeExecutor([serverErrorResponse]);

      const result = await executor.execute('retryDefaultLimit');

      // initial + 1 default retry = 2 attempts, then break-default.
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(result.steps[0].attempts, 2);
      assert.strictEqual(result.status, 'failed');
      assert.deepEqual(sleeps, []); // no retryAfter → sleep never called
    });

    specify('should proceed to the following step after a retry succeeds', async function () {
      // flaky fails once (500) then succeeds (200); control must continue to the
      // `after` step rather than stopping at the recovered retry.
      const { executor } = makeExecutor([serverErrorResponse, okResponse]);

      const result = await executor.execute('retryThenSucceedThenNext');

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['flaky', 'after'],
      );
      assert.strictEqual(result.steps[0].attempts, 2); // flaky: initial + 1 retry
      assert.strictEqual(result.steps[1].attempts, 1); // after: ran once
      assert.strictEqual(result.outputs.after, 200);
    });

    specify('should count retry attempts against the step budget', async function () {
      // retryExhaustedThenBreak retries a persistent 500 (retryLimit 2 → 3
      // attempts); a maxSteps of 2 must halt it via the step-budget guard,
      // proving retries are bounded, not just outer step entries.
      const { executor } = makeExecutor([serverErrorResponse], { maxSteps: 2 });

      await rejects(
        executor.execute('retryExhaustedThenBreak'),
        ExecutionError,
        /budget of 2 step attempts/,
      );
    });

    specify('should exhaust retries before firing a subsequent failure action', async function () {
      // always 500: retry (limit 2) is exhausted, then the subsequent end fires.
      const { executor, calls, sleeps } = makeExecutor([serverErrorResponse]);

      const result = await executor.execute('retryExhaustedThenEnd');

      assert.strictEqual(result.status, 'ended');
      // initial + 2 retries = 3 attempts on the doomed step; unreached never ran.
      assert.strictEqual(calls.length, 3);
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['doomed'],
      );
      assert.strictEqual(result.steps[0].attempts, 3);
      assert.deepEqual(sleeps, [1000, 1000]);
    });

    specify(
      'should fall to the break-default when retries exhaust with no next action',
      async function () {
        const { executor } = makeExecutor([serverErrorResponse]);

        const result = await executor.execute('retryExhaustedThenBreak');

        assert.strictEqual(result.status, 'failed');
        assert.strictEqual(result.steps[0].attempts, 3); // initial + 2 retries
        assert.isFalse(result.steps[0].successful);
      },
    );

    specify('should give each retry in a chain its own independent budget', async function () {
      // always 500: retryFast (limit 2) exhausts, then retrySlow (limit 3)
      // exhausts on its own budget, then the terminal end fires.
      const { executor, calls, sleeps } = makeExecutor([serverErrorResponse]);

      const result = await executor.execute('retryChainIndependentBudgets');

      assert.strictEqual(result.status, 'ended');
      // initial + 2 (fast) + 3 (slow) = 6 attempts.
      assert.strictEqual(calls.length, 6);
      assert.strictEqual(result.steps[0].attempts, 6);
      // 2 fast delays (1s) then 3 slow delays (5s).
      assert.deepEqual(sleeps, [1000, 1000, 5000, 5000, 5000]);
    });

    specify('should fall through an exhausted retry to a goto action', async function () {
      // doomed fails twice (initial + 1 retry, both 500) exhausting the retry,
      // then the subsequent goto jumps to recovery (3rd call → 200), skipping the
      // step in between.
      const { executor } = makeExecutor([serverErrorResponse, serverErrorResponse, okResponse]);

      const result = await executor.execute('retryExhaustedThenGoto');

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['doomed', 'recovery'],
      );
      assert.strictEqual(result.steps[0].attempts, 2); // initial + 1 retry
      assert.isUndefined(result.outputs.skipped);
      assert.strictEqual(result.outputs.recovery, 200);
    });

    specify('should re-select against the fresh response each attempt', async function () {
      // the retry matches only a 503. Attempt 1 → 503 (retry fires); attempt 2 →
      // 500, so the retry's criteria no longer match and it is not re-selected —
      // with no other action the run breaks, despite retryLimit being 5.
      const { executor, calls } = makeExecutor([serviceUnavailableResponse, serverErrorResponse]);

      const result = await executor.execute('retryCriteriaStopMatching');

      assert.strictEqual(result.status, 'failed');
      // 2 attempts only — the retry did not fire again once the 500 arrived.
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(result.steps[0].attempts, 2);
    });
  });

  context('step executor injection', function () {
    specify('should delegate steps to the injected stepExecutor', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const executor = new WorkflowExecutor({
        document: entry,
        registry,
        stepExecutor: makeStepExecutor([okResponse], calls),
      });

      const result = await executor.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls.length, 2);
    });
  });

  context('authoring errors', function () {
    specify('should throw workflow-not-found for an unknown workflowId', async function () {
      const { executor } = makeExecutor();

      await rejects(executor.execute('noSuchWorkflow'), ExecutionError, /not found/);
    });

    specify(
      'should reject unknown execute options rather than run without them',
      async function () {
        // `execute` once took inputs as its second positional argument. That call
        // now lands as an options bag of unrecognized keys, which would otherwise
        // run with no inputs at all and issue wrong requests while reporting
        // success.
        const { executor, calls } = makeExecutor();

        await rejects(
          executor.execute('linear', { status: 'available' } as unknown as WorkflowExecuteOptions),
          ExecutionError,
          /unknown option\(s\) status/,
        );
        assert.strictEqual(calls.length, 0);
      },
    );
  });

  context('cancellation', function () {
    specify('should refuse to start a run whose signal has already fired', async function () {
      const { executor, calls } = makeExecutor();
      const controller = new AbortController();
      controller.abort();

      const error = await captureError(
        executor.execute('linear', { inputs: { status: 'available' }, signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.match(error.message, /run aborted before workflow "linear"/);
      assert.deepEqual(error.path, ['linear']);
      assert.strictEqual(calls.length, 0);
    });

    specify('should stop at the next step when aborted mid-run', async function () {
      // aborted while the first step's request is in flight: that step finishes
      // (its response is already on the way back) and the run stops there rather
      // than working through the rest of the workflow.
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('linear', { inputs: { status: 'available' }, signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'linear');
      assert.strictEqual(error.stepId, 'getPet');
      assert.strictEqual(calls.length, 1);
    });

    specify('should stop between retry attempts when aborted', async function () {
      // the step fails (500) and its retry fires, so the abort lands between two
      // attempts of the same step — the boundary a step-level check would miss.
      const controller = new AbortController();
      const { executor, calls, sleeps } = makeExecutor([serverErrorResponse], {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('retryThenSucceed', { signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.stepId, 'flaky');
      // the retry never ran; the injected sleep, which ignores the signal, was
      // still asked to wait once before the cancellation surfaced.
      assert.strictEqual(calls.length, 1);
      assert.deepEqual(sleeps, [2000]);
    });

    specify('should not resolve a run abandoned during its last step', async function () {
      // the transport here ignores the signal, which the HTTPClient contract
      // permits — so the final step succeeds and no further boundary follows it.
      // Without a closing check the run would hand back outputs the caller had
      // already withdrawn from, and only for transports that ignore the signal.
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => {
          if (calls.length === 2) controller.abort();
        },
      });

      const error = await captureError(
        executor.execute('linear', { inputs: { status: 'available' }, signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'linear');
      // both steps did run — this is the boundary after the last one.
      assert.strictEqual(calls.length, 2);
    });

    specify('should name the workflow and chain for an abort mid-request', async function () {
      // a transport that honors the signal rejects the request it was told to
      // drop. StepExecutor turns that into the abort, but knows only the step;
      // the run must still report which workflow, and the chain it sat in.
      const controller = new AbortController();
      const httpClient: HTTPClient = async () => {
        controller.abort();
        throw new DOMException('This operation was aborted', 'AbortError');
      };
      const executor = new WorkflowExecutor({
        document: entry,
        registry,
        stepExecutor: new StepExecutor({
          document: entry,
          registry,
          operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
        }),
      });

      const error = await captureError(
        executor.execute('linear', { inputs: { status: 'available' }, signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'linear');
      assert.strictEqual(error.stepId, 'findPets');
      assert.deepEqual(error.path, ['linear']);
    });

    specify('should carry the abort reason as the error cause', async function () {
      const { executor } = makeExecutor();
      const controller = new AbortController();
      const reason = new Error('user navigated away');
      controller.abort(reason);

      const error = await captureError(executor.execute('linear', { signal: controller.signal }));

      assert.strictEqual(error.cause, reason);
    });

    specify('should forward a live signal to the transport', async function () {
      const { executor, calls } = makeExecutor();
      const controller = new AbortController();

      const result = await executor.execute('linear', {
        inputs: { status: 'available' },
        signal: controller.signal,
      });

      // a signal that never fires changes nothing about the run, but must reach
      // the request so a transport can cancel one in flight.
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls[0].signal, controller.signal);
    });

    specify('should cancel the run for a signal passed in executeOptions', async function () {
      // the bag was the only channel before `signal` existed. Observed only at
      // dispatch it would abort requests while the loop walked on, so it gates
      // the executor's boundaries too — here, the second step never starts.
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('linear', {
          inputs: { status: 'available' },
          executeOptions: { signal: controller.signal },
        }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.stepId, 'getPet');
      assert.strictEqual(calls.length, 1);
    });

    specify('should ignore a bag value that is not a usable signal', async function () {
      // the bag is open, so anything may be under `signal`. A value the runner
      // cannot subscribe to is not a cancellation: taking it for one would
      // trade a working run for a TypeError thrown from inside a retry wait.
      const { executor, calls } = makeExecutor();

      const result = await executor.execute('linear', {
        inputs: { status: 'available' },
        executeOptions: { signal: { aborted: true } },
      });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls.length, 2);
    });

    specify('should take precedence over a signal smuggled in executeOptions', async function () {
      const { executor, calls } = makeExecutor();
      const stale = new AbortController();
      const controller = new AbortController();

      await executor.execute('linear', {
        inputs: { status: 'available' },
        executeOptions: { signal: stale.signal },
        signal: controller.signal,
      });

      assert.strictEqual(calls[0].signal, controller.signal);
    });
  });

  context('references into a non-Arazzo source', function () {
    specify(
      'should throw for a goto workflowId reference into an OpenAPI source',
      async function () {
        const { executor } = makeExecutor();

        await rejects(
          executor.execute('gotoCrossDocument'),
          ExecutionError,
          /names source description "petstoreAPI" at .+, which is not an Arazzo document/,
        );
      },
    );

    specify(
      'should throw for a retry workflowId reference into an OpenAPI source',
      async function () {
        const { executor } = makeExecutor([serverErrorResponse]);

        await rejects(
          executor.execute('retryReferenceCrossDocument'),
          ExecutionError,
          /names source description "petstoreAPI" at .+, which is not an Arazzo document/,
        );
      },
    );
  });

  context('transfer to a workflow', function () {
    specify(
      'should transfer to the target and end its own run without evaluating outputs',
      async function () {
        const { executor, calls } = makeExecutor();

        const result = await executor.execute('transfersToTarget');

        assert.strictEqual(result.status, 'transferred');
        assert.strictEqual(result.workflowId, 'transfersToTarget');
        // the caller's own outputs declaration is never evaluated, despite
        // naming a value the caller's own step did produce.
        assert.deepEqual(result.outputs, {});
        // the partial trace up to the transfer — only the caller's own step.
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['only'],
        );
        assert.isTrue(result.steps[0].successful);

        // the top-level status is 'transferred', but settledStatus reflects
        // where the chain actually landed — computed eagerly, no call needed.
        assert.strictEqual(result.settledStatus, 'completed');

        assert.isDefined(result.transferredTo);
        const target = result.transferredTo!;
        assert.strictEqual(target.workflowId, 'transferTarget');
        assert.strictEqual(target.status, 'completed');
        // a non-transferred result's settledStatus is simply its own status.
        assert.strictEqual(target.settledStatus, 'completed');
        assert.deepEqual(
          target.steps.map((step) => step.stepId),
          ['first', 'second'],
        );
        assert.strictEqual(target.outputs.name, 'Rex');
        // a goto's transfer carries no parameters, so the target runs with {}
        // inputs — the same gap issue #62 already documents for retry
        // references.
        assert.isUndefined(target.outputs.echoedStatus);
        // the target has no transfer of its own.
        assert.isUndefined(target.transferredTo);

        // 1 call for the caller's own step, 2 for the target's.
        assert.strictEqual(calls.length, 3);
      },
    );

    specify('should chain a transfer to a transfer, recursively', async function () {
      const { executor } = makeExecutor();

      const result = await executor.execute('transferChainStart');

      assert.strictEqual(result.status, 'transferred');
      assert.strictEqual(result.transferredTo?.workflowId, 'transferChainMiddle');
      assert.strictEqual(result.transferredTo?.status, 'transferred');
      assert.strictEqual(result.transferredTo?.transferredTo?.workflowId, 'transferTarget');
      assert.strictEqual(result.transferredTo?.transferredTo?.status, 'completed');
      // settledStatus is computed eagerly at every hop, so both the root and
      // the middle link already carry the terminal verdict, not just the
      // terminal result itself.
      assert.strictEqual(result.settledStatus, 'completed');
      assert.strictEqual(result.transferredTo?.settledStatus, 'completed');
      // settledResult chases the whole two-hop chain to its terminal result,
      // for callers who want the terminal result itself, not just its status.
      assert.strictEqual(settledResult(result).workflowId, 'transferTarget');
      assert.strictEqual(settledResult(result).status, 'completed');
    });

    specify(
      'should return a non-transferred result from settledResult unchanged, with settledStatus mirroring status',
      async function () {
        const { executor } = makeExecutor();

        const result = await executor.execute('linear', { inputs: { status: 'available' } });

        assert.strictEqual(settledResult(result), result);
        assert.strictEqual(result.settledStatus, result.status);
      },
    );

    specify('should transfer from the failure path as readily as from success', async function () {
      // every client returns a 500, so the step's successCriteria fail and its
      // onFailure — a goto to a workflowId — fires.
      const { executor } = makeExecutor(serverErrorResponse);

      const result = await executor.execute('transferOnFailure');

      assert.strictEqual(result.status, 'transferred');
      assert.strictEqual(result.transferredTo?.workflowId, 'emptyWorkflow');
      assert.strictEqual(result.transferredTo?.status, 'completed');
    });

    specify('should reject a goto naming both a stepId and a workflowId', async function () {
      const { executor, calls } = makeExecutor();

      const error = await captureError(executor.execute('gotoAmbiguous'));

      assert.strictEqual(error.reason, 'ambiguous-target');
      assert.match(error.message, /mutually exclusive/);
      // rejected before either branch could act on it.
      assert.strictEqual(calls.length, 1);
    });

    specify(
      'should throw workflow-not-found, naming the calling step, for a transfer to an unknown workflow',
      async function () {
        const { executor } = makeExecutor();

        const error = await captureError(executor.execute('gotoUnknownWorkflow'));

        assert.strictEqual(error.reason, 'workflow-not-found');
        assert.match(error.message, /not found/);
        // several steps could goto the same missing id; naming the calling
        // step (not just the missing target) is what lets an author tell
        // which one is wrong.
        assert.strictEqual(error.stepId, 'only');
      },
    );

    specify(
      'should report an abort at the transfer boundary as aborted, even for a cross-document target',
      async function () {
        // the abort is checked before the reference helper resolves the
        // target (here, a workflow reference into a non-Arazzo source), so a
        // run cancelled at the transfer boundary reports why it stopped
        // (aborted), not an authoring property of a target it never got to
        // evaluate.
        const controller = new AbortController();
        const { executor, calls } = makeExecutor(okResponse, {
          onCall: () => controller.abort(),
        });

        const error = await captureError(
          executor.execute('gotoCrossDocument', { signal: controller.signal }),
        );

        assert.strictEqual(error.reason, 'aborted');
        assert.strictEqual(calls.length, 1);
      },
    );

    specify('should not charge the step budget for entering the target', async function () {
      // maxSteps: 1 covers only the caller's own step; entering the (empty)
      // target must not cost another unit, unlike a retry's workflowId
      // reference, which does charge on entry.
      const { executor } = makeExecutor(okResponse, { maxSteps: 1 });

      const result = await executor.execute('transfersToEmpty');

      assert.strictEqual(result.status, 'transferred');
      assert.strictEqual(result.transferredTo?.status, 'completed');
    });

    specify('should not enter the target once aborted at the transfer boundary', async function () {
      const controller = new AbortController();
      const { executor, calls } = makeExecutor(okResponse, {
        onCall: () => controller.abort(),
      });

      const error = await captureError(
        executor.execute('transfersToTarget', { signal: controller.signal }),
      );

      assert.strictEqual(error.reason, 'aborted');
      assert.strictEqual(error.workflowId, 'transfersToTarget');
      assert.strictEqual(error.stepId, 'only');
      // the caller's own step ran; the target was never entered.
      assert.strictEqual(calls.length, 1);
    });

    specify(
      'should let a caller detect a failure buried in the transfer chain via settledStatus',
      async function () {
        // the caller's own step has no successCriteria, so it transfers
        // regardless of status; failBreak's own step does, and 500 fails it.
        const { executor } = makeExecutor(serverErrorResponse);

        const result = await executor.execute('transfersToFailing');

        // the top-level status is 'transferred', not 'failed' — checking it
        // directly, the way `result.status === 'failed'` naturally reads,
        // would miss the failure entirely.
        assert.strictEqual(result.status, 'transferred');
        assert.notStrictEqual(result.status, 'failed');
        // settledStatus already carries the terminal verdict — no call
        // needed to discover it landed on 'failed'.
        assert.strictEqual(result.settledStatus, 'failed');
        // settledResult(result), for comparison, retrieves the terminal
        // result itself (its workflowId, outputs, steps), not just its
        // status.
        assert.strictEqual(settledResult(result).status, 'failed');
        assert.strictEqual(settledResult(result).workflowId, 'failBreak');
      },
    );
  });

  context('retry reference', function () {
    specify('should run a self-referencing stepId reference before each retry', async function () {
      // always 500, retryLimit 2: the retry fires twice, so its self-reference
      // (one more "doomed" attempt) runs twice too — 3 step attempts + 2
      // reference attempts = 5 calls. A failed reference does not break the
      // chain: the run still falls to the break-default once retries exhaust.
      const { executor, calls } = makeExecutor([serverErrorResponse]);

      const result = await executor.execute('retryWithReference');

      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(calls.length, 5);
      assert.strictEqual(result.steps[0].attempts, 3);
      assert.strictEqual(result.steps[0].retryReferences?.length, 2);
      for (const reference of result.steps[0].retryReferences ?? []) {
        assert.strictEqual(reference.kind, 'step');
        assert.strictEqual(reference.id, 'doomed');
        assert.isFalse(reference.successful);
      }
    });

    specify(
      "should run a stepId reference and have the next attempt read the reference's outputs",
      async function () {
        // login (initial) → token A; call (attempt 1) → 500, firing the retry
        // reference, which re-runs login → token B; call (attempt 2) → 200.
        // The workflow's own outputs must read token B: the reference's run
        // overwrote login's recorded outputs — "context transfers back".
        const { executor, calls } = makeExecutor([
          { status: 200, statusText: 'OK', body: { token: 'A' } },
          serverErrorResponse,
          { status: 200, statusText: 'OK', body: { token: 'B' } },
          okResponse,
        ]);

        const result = await executor.execute('retryWithRepairStep');

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(calls.length, 4);
        assert.deepEqual(
          result.steps.map((step) => step.stepId),
          ['login', 'call'],
        );
        assert.strictEqual(result.steps[0].attempts, 1); // login's own run
        assert.strictEqual(result.steps[1].attempts, 2); // call: initial + 1 retry
        assert.strictEqual(result.steps[1].retryReferences?.length, 1);
        assert.deepEqual(result.steps[1].retryReferences?.[0], {
          kind: 'step',
          id: 'login',
          successful: true,
        });
        assert.strictEqual(result.outputs.token, 'B');
        assert.strictEqual(result.outputs.status, 200);
      },
    );

    specify(
      'should throw when a retry references a stepId this workflow does not declare',
      async function () {
        // the first attempt fails (500), firing the retry, whose reference names
        // a step that does not exist — checked lazily, only once the action
        // actually fires.
        const { executor } = makeExecutor([serverErrorResponse]);

        const error = await captureError(executor.execute('retryReferenceTargetMissing'));

        assert.strictEqual(error.reason, 'retry-target-not-found');
        // names the missing target, matching the goto-target-not-found convention
        // this reuses (`indexOfStep`) — not the step whose retry referenced it.
        assert.strictEqual(error.stepId, 'nonexistent');
        assert.strictEqual(error.workflowId, 'retryReferenceTargetMissing');
        assert.match(error.message, /retry reference step "nonexistent" not found/);
      },
    );

    specify(
      'should run a workflowId reference to completion before the next attempt',
      async function () {
        // call fails once (500), firing the retry, whose workflowId reference
        // (repairFlow) runs to completion; call then succeeds (200).
        const { executor, calls } = makeExecutor([serverErrorResponse, okResponse]);

        const result = await executor.execute('retryWithWorkflowReference');

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(calls.length, 3); // call attempt 1, repairFlow's step, call attempt 2
        assert.strictEqual(result.steps[0].attempts, 2);
        assert.strictEqual(result.steps[0].retryReferences?.length, 1);
        const reference = result.steps[0].retryReferences?.[0];
        assert.strictEqual(reference?.kind, 'workflow');
        assert.strictEqual(reference?.id, 'repairFlow');
        assert.isTrue(reference?.successful);
        assert.strictEqual(reference?.subWorkflow?.workflowId, 'repairFlow');
        assert.strictEqual(reference?.subWorkflow?.status, 'completed');
        // recorded under $workflows too, readable from the parent's own outputs.
        assert.strictEqual(result.outputs.repaired, 200);
      },
    );

    specify(
      'should charge the step budget for a reference the same as any other attempt',
      async function () {
        // maxSteps: 2 covers login's own attempt and call's first attempt; the
        // reference's attempt at login is the one that trips it — proving the
        // reference is charged, not free.
        const { executor, calls } = makeExecutor(
          [{ status: 200, statusText: 'OK', body: { token: 'A' } }, serverErrorResponse],
          { maxSteps: 2 },
        );

        const error = await captureError(executor.execute('retryWithRepairStep'));

        assert.strictEqual(error.reason, 'step-budget');
        assert.strictEqual(calls.length, 2);
      },
    );

    specify(
      'should not run the reference when aborted during the retryAfter wait',
      async function () {
        // the injected sleep ignores the signal, as in the other cancellation
        // tests, so it is still asked to wait once — but the reference itself,
        // checked before it runs, never gets to make a request.
        const controller = new AbortController();
        const { executor, calls, sleeps } = makeExecutor([serverErrorResponse], {
          onCall: () => controller.abort(),
        });

        const error = await captureError(
          executor.execute('retryWithReferenceDelay', { signal: controller.signal }),
        );

        assert.strictEqual(error.reason, 'aborted');
        assert.strictEqual(calls.length, 1);
        assert.deepEqual(sleeps, [3000]);
      },
    );

    specify(
      'should reject a retry action naming both a stepId and a workflowId',
      async function () {
        const { executor, calls } = makeExecutor([serverErrorResponse]);

        const error = await captureError(executor.execute('retryAmbiguousReference'));

        assert.strictEqual(error.reason, 'ambiguous-target');
        assert.strictEqual(error.stepId, 'doomed');
        assert.strictEqual(error.workflowId, 'retryAmbiguousReference');
        assert.match(error.message, /declares both a stepId and a workflowId/);
        // rejected before either branch runs a live request.
        assert.strictEqual(calls.length, 1);
      },
    );

    specify(
      'should charge the step budget for entering a workflowId reference, even an empty one',
      async function () {
        // maxSteps: 2 covers doomed's own initial attempt and, once the fix is
        // in place, entering the reference; without that charge the run would
        // complete as 'failed' once the single retry exhausts, rather than
        // tripping the budget on doomed's own second attempt.
        const { executor } = makeExecutor([serverErrorResponse], { maxSteps: 2 });

        const error = await captureError(executor.execute('retryWithBudgetedWorkflowReference'));

        assert.strictEqual(error.reason, 'step-budget');
      },
    );

    specify(
      "should feed a retried sub-workflow step's next attempt with the reference's repair",
      async function () {
        // login (initial) → token A; call's first attempt echoes A, which
        // fails its criteria, firing the retry reference — a fresh run of
        // login → token B. The retried attempt at call must read B, not the
        // A its inputs were resolved with before the first attempt.
        const { executor, calls } = makeExecutor([
          { status: 200, statusText: 'OK', body: { token: 'A' } },
          okResponse,
          { status: 200, statusText: 'OK', body: { token: 'B' } },
          okResponse,
        ]);

        const result = await executor.execute('repairFeedsSubWorkflowStep');

        assert.strictEqual(result.status, 'completed');
        assert.strictEqual(calls.length, 4);
        assert.strictEqual(result.steps[1].attempts, 2); // call: initial + 1 retry
        assert.strictEqual(result.outputs.echoed, 'B');
      },
    );
  });

  context('malformed step declarations', function () {
    specify('should report a malformed onSuccess as a typed error', async function () {
      // `onSuccess: not-a-list` used to surface as a bare
      // `TypeError: actions is not iterable` — raised by the language, naming an
      // internal variable, with no `reason` a caller could branch on.
      const { executor } = makeExecutor();

      let caught: unknown;
      try {
        await executor.execute('malformedStepOnSuccess');
      } catch (error) {
        caught = error;
      }

      assert.instanceOf(caught, ResolverError);
      assert.strictEqual((caught as ResolverError).reason, 'malformed-actions');
      // names the step the malformed onSuccess belongs to, not just the field.
      assert.strictEqual((caught as ResolverError).stepId, 'broken');
      // the message names the key its author actually wrote, not both candidates.
      assert.match((caught as Error).message, /`onSuccess` is present but is not a list/);
    });
  });
});
