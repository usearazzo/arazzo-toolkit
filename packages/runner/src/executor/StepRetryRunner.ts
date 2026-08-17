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
   *
   * The `signal` is the run's cancellation, forwarded so a long `retryAfter` is
   * not sat out by a run the caller has already abandoned: the default timer
   * clears itself and returns early when it fires. An injected sleep that
   * ignores the signal is not wrong, it merely delays the cancellation until its
   * wait is over.
   */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Which step is being run — carried for diagnostics, plus the run's cancellation
 * so the wait between attempts can be cut short.
 * @internal
 */
export interface StepRetryRunContext {
  readonly stepId: string;
  readonly workflowId: string;
  readonly signal?: AbortSignal;
  /**
   * Runs a `retry` action's `stepId` / `workflowId` reference — "the reference
   * is executed and the context is returned, after which the current step is
   * retried". Called once per firing (i.e. before every attempt the action
   * grants, not once per chain), after the `retryAfter` wait and before the
   * step is re-run.
   *
   * This runner owns *when* a reference runs, never *what* it is — it does not
   * inspect `stepId` / `workflowId` itself, so a caller that omits this
   * callback gets the standalone `retry-reference-unsupported` rejection
   * below instead of a silently ignored reference. A caller that supplies it
   * is trusted to run the right thing; a throw from it ends the step, the
   * same as a throw from `attempt`.
   */
  readonly runReference?: (action: FailureActionElement) => Promise<void>;
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
 *
 * A `retry` action's `stepId` / `workflowId` reference works the same way: this
 * class only decides *when* one fires (once per firing, after the `retryAfter`
 * wait, before the step is re-run) — it hands the action to
 * {@link StepRetryRunContext.runReference} and knows nothing about *what* the
 * reference is or how it runs. A caller that omits that callback gets the
 * standalone rejection instead of a silently ignored reference.
 *
 * Cancellation is the one thing it will not wait out: the run's `AbortSignal`
 * reaches the timer, which returns early, and the next attempt then trips the
 * caller's own check. Turning an abort into an error stays the caller's job, as
 * with the budget; the signal is here only because a wait already in progress
 * cannot be cut short from inside the thunk.
 * @internal
 */
class StepRetryRunner {
  static readonly #DEFAULT_RETRY_LIMIT = 1;
  /**
   * A real timer that stops waiting as soon as the run is cancelled, and leaves
   * no pending timeout behind either way — a `retryAfter` of minutes would
   * otherwise hold the event loop open long after the caller walked away.
   *
   * It resolves on abort rather than rejecting: turning a cancellation into an
   * error is the caller's per-attempt check, which reports it uniformly for a
   * run cancelled mid-wait and one cancelled mid-request.
   */
  static readonly #DEFAULT_SLEEP = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }

      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      // unsubscribed when the wait ends normally, so a signal outliving many
      // retries does not accumulate a listener per wait.
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

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

        const reference = this.#referenced(action);
        if (reference && context.runReference === undefined) this.#rejectReference(context);
        retriesSpent.set(action, spent + 1);
        // only sleep for a real, positive delay — skip the event-loop yield of
        // sleep(0) for immediate retries, and never hand a custom sleep a
        // zero/negative/NaN value.
        const delayMs = this.#retryAfterMs(action);
        if (delayMs > 0) await this.#sleep(delayMs, context.signal);
        if (reference) await context.runReference!(action);
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
   * Whether a `retry` action carries a `stepId` / `workflowId` reference to
   * execute before retrying ("the reference is executed and the context is
   * returned, after which the current step is retried").
   */
  #referenced(action: FailureActionElement): boolean {
    return isStringElement(action.stepId) || isStringElement(action.workflowId);
  }

  /**
   * Rejects a referenced `retry` action when the caller supplied no
   * {@link StepRetryRunContext.runReference}, so an unsupported caller
   * (or a step retried directly against this runner in isolation) fails
   * loudly rather than silently ignoring the reference.
   */
  #rejectReference(context: StepRetryRunContext): void {
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

export default StepRetryRunner;
