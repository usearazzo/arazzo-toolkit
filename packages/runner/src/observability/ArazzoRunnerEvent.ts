import type { DocumentRegistryEvent } from './DocumentRegistryEvent.ts';
import type { OpenAPIOperationEvent } from './OpenAPIOperationEvent.ts';
import type { WorkflowExecutionEvent } from './WorkflowExecutionEvent.ts';

/**
 * How much detail an event is. `info` events trace the run itself: workflows,
 * steps, attempts and the decisions behind them. `debug` events trace the
 * machinery underneath: document loads, normalization and assembly.
 *
 * A level is detail, not severity: a failed step is an `info` event like a
 * successful one. Mapping outcomes to log severities is a consumer's choice.
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
   * clock (`performance.now` by default). Timestamps of different blocks
   * compare only when the blocks share a clock, as the ones
   * {@link ArazzoRunner} wires do.
   */
  readonly timestamp: number;
}

/**
 * Every event the runner's building blocks emit, discriminated by `type`.
 * @public
 */
export type ArazzoRunnerEvent =
  WorkflowExecutionEvent | DocumentRegistryEvent | OpenAPIOperationEvent;

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
 *
 * Each event is a frozen snapshot: its plain objects and arrays are copies
 * the run does not use, so changing one cannot reach the run (and, frozen,
 * throws). The one exception is an ApiDOM element, such as
 * {@link ActionSelectedEvent.action}: it is the document's own element,
 * shared with the trace, and must be treated as read-only.
 *
 * A building block without an observer builds no events at all.
 * @public
 */
export type ArazzoRunnerObserver<E extends ArazzoRunnerEvent = ArazzoRunnerEvent> = (
  event: E,
) => void;
