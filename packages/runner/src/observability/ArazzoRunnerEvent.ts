import type { WorkflowExecutionEvent } from './WorkflowExecutionEvent.ts';

/**
 * How much detail an event is. `info` events trace the run itself: workflows,
 * steps, attempts and the decisions behind them. `debug` events trace the
 * machinery underneath: document loads, normalization and assembly.
 * @public
 */
export type ArazzoRunnerEventLevel = 'info' | 'debug';

/**
 * The fields every {@link ArazzoRunnerEvent} carries.
 * @public
 */
export interface ArazzoRunnerEventBase {
  readonly level: ArazzoRunnerEventLevel;
  /**
   * When the event happened, read from the emitting block's injected `now`
   * clock (`performance.now` by default).
   */
  readonly timestamp: number;
}

/**
 * Every event the runner's building blocks emit, discriminated by `type`.
 * @public
 */
export type ArazzoRunnerEvent = WorkflowExecutionEvent;

/**
 * Receives events as they happen. Each building block takes one through its
 * `observer` option, typed to the events that block emits; an observer of
 * every {@link ArazzoRunnerEvent} fits them all.
 *
 * It is called synchronously and never awaited, so observing cannot slow
 * down, reorder or otherwise change a run; a returned promise is ignored. A
 * handler that throws aborts the work in progress with that error: the
 * observer is the caller's own code, and swallowing its errors would hide its
 * bugs.
 * @public
 */
export type ArazzoRunnerObserver<E extends ArazzoRunnerEvent = ArazzoRunnerEvent> = (
  event: E,
) => void;
