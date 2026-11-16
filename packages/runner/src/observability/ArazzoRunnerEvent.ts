import type { DocumentRegistryEvent } from './DocumentRegistryEvent.ts';
import type { OpenAPIOperationEvent } from './OpenAPIOperationEvent.ts';
import type { WorkflowExecutionEvent } from './WorkflowExecutionEvent.ts';

/**
 * The fields every {@link ArazzoRunnerEvent} carries.
 * @public
 */
export interface ArazzoRunnerEventBase {
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
 *
 * Events carry no level or severity, like Node's `diagnostics_channel`
 * messages: how to log an event is the logging consumer's decision. The
 * `document-*`, `workflow-normalize-*` and `operation-*` events describe the
 * machinery under a run, the detail a debug log would show.
 * @public
 */
export type ArazzoRunnerEvent =
  WorkflowExecutionEvent | DocumentRegistryEvent | OpenAPIOperationEvent;

/**
 * Receives events as they happen. Each building block takes one as its
 * `observer` option, typed to the events it emits; an observer of every
 * {@link ArazzoRunnerEvent} fits them all.
 *
 * It is called synchronously and never awaited, so it cannot slow down or
 * reorder a run. A handler that throws aborts the run with that error. A
 * returned promise is ignored, rejection included: an async observer handles
 * its own errors.
 *
 * Each event is a frozen copy of its plain data, so changing it cannot reach
 * the run. Anything else is shared and must be treated as read-only: the
 * ApiDOM element in {@link ActionSelectedEvent.action}, or a `Map` or class
 * instance a custom HTTP client put into a response body.
 *
 * A building block without an observer builds no events.
 * @public
 */
export type ArazzoRunnerObserver<E extends ArazzoRunnerEvent = ArazzoRunnerEvent> = (
  event: E,
) => void;
