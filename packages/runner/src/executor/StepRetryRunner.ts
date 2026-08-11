import { toValue } from '@speclynx/apidom-core';
import { isNumberElement, isStringElement } from '@speclynx/apidom-datamodel';
import { isFailureActionElement, type FailureActionElement } from '@speclynx/apidom-ns-arazzo-1';

import type { SelectedAction } from '../action/ActionResolver.ts';
import ExecutionError from '../errors/ExecutionError.ts';

/**
 * What one attempt at a step produced.
 *
 * Both kinds of step reduce to this — an operation step (whose richer
 * `StepExecutionResult` satisfies this shape) and a sub-workflow step
 * (synthesized from the sub-run's outcome) — so the retry loop drives them
 * identically and knows nothing about either.
 * @internal
 */
export interface StepAttemptOutcome {
  readonly stepId: string;
  readonly successful: boolean;
  readonly outputs: Record<string, unknown>;
  readonly action: SelectedAction | undefined;
  readonly matchedActions: readonly SelectedAction[];
}

/**
 * The terminal outcome of a step once its retries are settled.
 * @internal
 */
export interface StepRetryResult {
  /**
   * The last attempt's outcome.
   */
  readonly outcome: StepAttemptOutcome;
  /**
   * The action the retry chain resolved to — never a `retry`, and `undefined`
   * when nothing terminal matched, so the caller applies the path default.
   */
  readonly action: SelectedAction | undefined;
  /**
   * How many times the step ran.
   */
  readonly attempts: number;
}

/**
 * Options for the StepRetryRunner.
 * @internal
 */
export interface StepRetryRunnerOptions {
  /**
   * Delays for the given number of milliseconds, awaited between attempts
   * (`retryAfter`). Injected so tests pass a no-op and real runs delay; defaults
   * to a real timer.
   */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Which step is being run — carried for diagnostics only.
 * @internal
 */
export interface StepRetryRunContext {
  readonly stepId: string;
  readonly workflowId: string;
}

/**
 * Runs a step until its `retry` failure actions are settled.
 *
 * On success, or an immediate non-retry failure, the step runs once. On a failure
 * whose first matching action is a `retry`, the step is re-run up to that
 * action's `retryLimit` (default 1), waiting `retryAfter` seconds between
 * attempts. Per Arazzo 1.0.1 — "retryLimit MUST be exhausted prior to executing
 * subsequent failure actions" — an exhausted retry falls through to the *next*
 * matching failure action of the latest attempt, which may itself be another
 * `retry` with its own independent budget, or a terminal `end` / `goto`. Each
 * attempt re-runs the step and re-selects against the fresh outcome, so an action
 * whose criteria stop matching stops being chosen.
 *
 * It is agnostic about what a step *is*: the caller supplies a thunk that runs one
 * attempt and returns its {@link StepAttemptOutcome}, which is what lets an
 * operation step and a sub-workflow step retry through identical machinery. That
 * thunk is also where a caller puts anything it wants done per attempt — charging
 * a run budget, say — so this class needs no notion of one; a thunk that throws
 * ends the step there, without further attempts. One consequence is worth
 * knowing: a `retryAfter` delay is awaited before the next attempt begins, so a
 * caller whose per-attempt check is about to fail (a spent budget, say) still
 * pays that delay before its error surfaces. Keeping the seam this narrow is
 * worth one bounded wait on a run that was already doomed.
 * @internal
 */
class StepRetryRunner {
  static readonly #DEFAULT_RETRY_LIMIT = 1;
  static readonly #DEFAULT_SLEEP = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  readonly #sleep: (ms: number) => Promise<void>;

  constructor(options: StepRetryRunnerOptions = {}) {
    this.#sleep = options.sleep ?? StepRetryRunner.#DEFAULT_SLEEP;
  }

  /**
   * Runs `attempt` until the step succeeds, a terminal failure action is reached,
   * or its retries are exhausted.
   */
  async run(
    attempt: () => Promise<StepAttemptOutcome>,
    context: StepRetryRunContext,
  ): Promise<StepRetryResult> {
    // attempts already spent on each retry action, keyed by the action element.
    // The element is the correct identity here: re-running the step returns the
    // same element instances (the workflow is normalized once and `onFailure`'s
    // getter returns its stored children — nothing re-refracts per call), and
    // keying by the element survives the criteria re-filtering that varies
    // `matchedActions` between attempts (position within that filtered list is
    // NOT stable when a response change drops an earlier action). So each retry
    // in a chain keeps its own independent budget across re-runs.
    const retriesSpent = new Map<SelectedAction, number>();
    let attempts = 0;

    for (;;) {
      const outcome = await attempt();
      attempts += 1;

      if (outcome.successful) {
        return { outcome, action: outcome.action, attempts };
      }

      // walk the matching failure actions: fire the first retry that still has
      // budget, else fall through to the first terminal (non-retry) action.
      let fired = false;
      let terminal: SelectedAction | undefined;
      for (const action of outcome.matchedActions) {
        if (!this.#isRetry(action)) {
          terminal = action;
          break;
        }
        const spent = retriesSpent.get(action) ?? 0;
        if (spent >= this.#retryLimit(action)) continue; // exhausted — try the next action

        this.#rejectReference(action, context);
        retriesSpent.set(action, spent + 1);
        // only sleep for a real, positive delay — skip the event-loop yield of
        // sleep(0) for immediate retries, and never hand a custom sleep a
        // zero/negative/NaN value.
        const delayMs = this.#retryAfterMs(action);
        if (delayMs > 0) await this.#sleep(delayMs);
        fired = true;
        break;
      }

      if (fired) continue; // re-run the step
      return { outcome, action: terminal, attempts };
    }
  }

  /**
   * Whether a matched action is a `retry` failure action (narrowing it to
   * {@link FailureActionElement} so `retryLimit` / `retryAfter` are accessible).
   */
  #isRetry(action: SelectedAction): action is FailureActionElement {
    return isFailureActionElement(action) && (toValue(action.type) as string) === 'retry';
  }

  /**
   * A `retry` action's attempt budget — its `retryLimit`, or the default of 1
   * when unset or non-numeric.
   */
  #retryLimit(action: FailureActionElement): number {
    return isNumberElement(action.retryLimit)
      ? (toValue(action.retryLimit) as number)
      : StepRetryRunner.#DEFAULT_RETRY_LIMIT;
  }

  /**
   * The delay before a retry, in milliseconds — the action's `retryAfter`
   * (seconds) converted. `0` when unset, non-numeric, or not a finite positive
   * value (a negative or `NaN` `retryAfter` means "no wait", never a bad value
   * handed to `sleep`).
   */
  #retryAfterMs(action: FailureActionElement): number {
    if (!isNumberElement(action.retryAfter)) return 0;
    const ms = (toValue(action.retryAfter) as number) * 1000;
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  /**
   * Rejects a `retry` action that carries a `stepId` / `workflowId` reference to
   * execute before retrying — a defined feature ("the reference is executed and
   * the context is returned, after which the current step is retried") that is
   * not yet supported, so it throws rather than silently ignoring the reference.
   */
  #rejectReference(action: FailureActionElement, context: StepRetryRunContext): void {
    if (isStringElement(action.stepId) || isStringElement(action.workflowId)) {
      throw new ExecutionError(
        `retry action on step "${context.stepId}" in workflow "${context.workflowId}" carries a stepId/workflowId reference; not supported yet`,
        {
          stepId: context.stepId,
          workflowId: context.workflowId,
          reason: 'retry-reference-unsupported',
        },
      );
    }
  }
}

export default StepRetryRunner;
