import { assert } from 'chai';
import { StepOnFailureElement, refractFailureAction } from '@speclynx/apidom-ns-arazzo-1';

import {
  StepRetryRunner,
  ExecutionError,
  type StepAttemptOutcome,
  type SelectedAction,
} from '../../src/index.ts';

describe('StepRetryRunner', function () {
  const runContext = { stepId: 'only', workflowId: 'wf' };

  /**
   * The failure actions a step matched, as the elements the runner receives —
   * refracted the same way `ActionResolver` hands them over.
   */
  const matched = (...actions: unknown[]): readonly SelectedAction[] =>
    [
      ...new StepOnFailureElement(actions.map((action) => refractFailureAction(action))),
    ] as readonly SelectedAction[];

  /**
   * A step whose attempts follow `outcomes` — each entry says whether that
   * attempt succeeded and which failure actions it matched. The last entry
   * repeats once exhausted, so a single entry is a step that always does the same
   * thing. Records the attempts it was asked for.
   */
  const step = (
    outcomes: readonly { successful: boolean; matchedActions?: readonly SelectedAction[] }[],
  ): { attempt: () => Promise<StepAttemptOutcome>; calls: number } => {
    const state = {
      calls: 0,
      attempt: async (): Promise<StepAttemptOutcome> => {
        const outcome = outcomes[Math.min(state.calls, outcomes.length - 1)];
        state.calls += 1;
        const matchedActions = outcome.matchedActions ?? [];
        return {
          stepId: runContext.stepId,
          successful: outcome.successful,
          outputs: {},
          action: matchedActions[0],
          matchedActions,
        };
      },
    };
    return state;
  };

  /**
   * A runner whose timer records what it was asked to wait instead of waiting.
   */
  const makeRunner = (): { runner: StepRetryRunner; sleeps: number[] } => {
    const sleeps: number[] = [];
    const runner = new StepRetryRunner({
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    return { runner, sleeps };
  };

  context('without retries', function () {
    specify('should run a successful step once', async function () {
      const { runner } = makeRunner();
      const target = step([{ successful: true }]);

      const result = await runner.run(target.attempt, runContext);

      assert.strictEqual(result.attempts, 1);
      assert.strictEqual(target.calls, 1);
      assert.isTrue(result.outcome.successful);
    });

    specify('should return a terminal failure action without re-running', async function () {
      const { runner } = makeRunner();
      const target = step([
        { successful: false, matchedActions: matched({ name: 'stop', type: 'end' }) },
      ]);

      const result = await runner.run(target.attempt, runContext);

      assert.strictEqual(result.attempts, 1);
      assert.strictEqual(result.action, result.outcome.matchedActions[0]);
    });

    specify(
      'should return no action when nothing matched, for the path default',
      async function () {
        const { runner } = makeRunner();
        const target = step([{ successful: false }]);

        const result = await runner.run(target.attempt, runContext);

        assert.isUndefined(result.action);
        assert.strictEqual(result.attempts, 1);
      },
    );
  });

  context('retrying', function () {
    specify('should retry until the step succeeds', async function () {
      const { runner, sleeps } = makeRunner();
      const retry = matched({ name: 'again', type: 'retry', retryLimit: 3, retryAfter: 2 });
      const target = step([
        { successful: false, matchedActions: retry },
        { successful: false, matchedActions: retry },
        { successful: true },
      ]);

      const result = await runner.run(target.attempt, runContext);

      assert.strictEqual(result.attempts, 3);
      assert.isTrue(result.outcome.successful);
      assert.deepEqual(sleeps, [2000, 2000]);
    });

    specify('should default retryLimit to 1 and not sleep without retryAfter', async function () {
      const { runner, sleeps } = makeRunner();
      const target = step([
        { successful: false, matchedActions: matched({ name: 'again', type: 'retry' }) },
      ]);

      const result = await runner.run(target.attempt, runContext);

      // the initial attempt plus one default retry.
      assert.strictEqual(result.attempts, 2);
      assert.deepEqual(sleeps, []);
    });

    specify('should fall through an exhausted retry to the next action', async function () {
      const { runner } = makeRunner();
      const actions = matched(
        { name: 'again', type: 'retry', retryLimit: 2 },
        { name: 'stop', type: 'end' },
      );
      const target = step([{ successful: false, matchedActions: actions }]);

      const result = await runner.run(target.attempt, runContext);

      // initial + 2 retries, then the end action.
      assert.strictEqual(result.attempts, 3);
      assert.strictEqual(result.action, actions[1]);
    });

    specify('should give each retry in a chain its own budget', async function () {
      const { runner, sleeps } = makeRunner();
      const actions = matched(
        { name: 'fast', type: 'retry', retryLimit: 2, retryAfter: 1 },
        { name: 'slow', type: 'retry', retryLimit: 3, retryAfter: 5 },
        { name: 'stop', type: 'end' },
      );
      const target = step([{ successful: false, matchedActions: actions }]);

      const result = await runner.run(target.attempt, runContext);

      // initial + 2 fast + 3 slow.
      assert.strictEqual(result.attempts, 6);
      assert.deepEqual(sleeps, [1000, 1000, 5000, 5000, 5000]);
      assert.strictEqual(result.action, actions[2]);
    });

    specify('should re-select against each fresh outcome', async function () {
      const { runner } = makeRunner();
      // the retry matches the first attempt only; the second attempt matches
      // nothing, so the step is not retried again despite its ample retryLimit.
      const target = step([
        {
          successful: false,
          matchedActions: matched({ name: 'again', type: 'retry', retryLimit: 5 }),
        },
        { successful: false },
      ]);

      const result = await runner.run(target.attempt, runContext);

      assert.strictEqual(result.attempts, 2);
      assert.isUndefined(result.action);
    });

    specify('should ignore a non-positive retryAfter rather than sleep on it', async function () {
      const { runner, sleeps } = makeRunner();
      const target = step([
        {
          successful: false,
          matchedActions: matched({ name: 'again', type: 'retry', retryAfter: -1 }),
        },
      ]);

      await runner.run(target.attempt, runContext);

      assert.deepEqual(sleeps, []);
    });
  });

  context('beforeAttempt', function () {
    specify('should run before every attempt, the first included', async function () {
      const { runner } = makeRunner();
      const target = step([
        {
          successful: false,
          matchedActions: matched({ name: 'again', type: 'retry', retryLimit: 2 }),
        },
      ]);
      let charged = 0;

      const result = await runner.run(target.attempt, {
        ...runContext,
        beforeAttempt: () => {
          charged += 1;
        },
      });

      assert.strictEqual(charged, result.attempts);
      assert.strictEqual(charged, 3);
    });

    specify('should abort the step when it throws', async function () {
      const { runner } = makeRunner();
      const target = step([
        {
          successful: false,
          matchedActions: matched({ name: 'again', type: 'retry', retryLimit: 99 }),
        },
      ]);
      const budget = new Error('budget spent');
      let attemptsAllowed = 2;

      let caught: unknown;
      try {
        await runner.run(target.attempt, {
          ...runContext,
          beforeAttempt: () => {
            if (attemptsAllowed-- <= 0) throw budget;
          },
        });
      } catch (error) {
        caught = error;
      }

      assert.strictEqual(caught, budget);
      // it stopped where the caller said, rather than running to retryLimit.
      assert.strictEqual(target.calls, 2);
    });
  });

  context('not yet supported', function () {
    specify('should reject a retry carrying a stepId/workflowId reference', async function () {
      const { runner } = makeRunner();
      const target = step([
        {
          successful: false,
          matchedActions: matched({ name: 'again', type: 'retry', stepId: 'other' }),
        },
      ]);

      let caught: unknown;
      try {
        await runner.run(target.attempt, runContext);
      } catch (error) {
        caught = error;
      }

      assert.instanceOf(caught, ExecutionError);
      assert.strictEqual((caught as ExecutionError).reason, 'retry-reference-unsupported');
    });
  });
});
