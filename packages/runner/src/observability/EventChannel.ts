import { isPlainObject } from 'ramda-adjunct';

import type { ArazzoRunnerEvent, ArazzoRunnerObserver } from './ArazzoRunnerEvent.ts';
import { isInstrumented, notify } from './instrument.ts';

/**
 * An event without its `timestamp`, which the channel stamps. Distributes over
 * a union, so each member keeps its own discriminated shape.
 * @internal
 */
export type UnstampedEvent<E> = E extends unknown ? Omit<E, 'timestamp'> : never;

/**
 * Options for the EventChannel.
 * @internal
 */
export interface EventChannelOptions<E extends ArazzoRunnerEvent> {
  readonly observer?: ArazzoRunnerObserver<E> | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * Delivers a building block's events to its observer, then to the
 * process-wide observers {@link instrument} registered: stamps each with the
 * block's clock, snapshots it, and hands it over synchronously, without
 * awaiting anything.
 *
 * A block emits through `this.#events?.emit(...)`, where `#events` is
 * {@link EventChannel.observed}: with nobody observing, optional chaining
 * skips evaluating the event too, so an unobserved run builds no events at
 * all.
 * @internal
 */
class EventChannel<E extends ArazzoRunnerEvent> {
  static readonly #DEFAULT_NOW = (): number => performance.now();

  /**
   * A frozen deep copy of the plain objects and arrays in `value`; anything
   * else, an ApiDOM element above all, is shared as it is. The run keeps
   * using the objects an event describes (the trace's records, the outputs,
   * the context a request interceptor receives, the transition it acts on),
   * so handing out the originals would let an observer change the run.
   */
  static #snapshot(value: unknown, copies: WeakMap<object, unknown>): unknown {
    if (!Array.isArray(value) && !isPlainObject(value)) return value;

    const seen = copies.get(value as object);
    if (seen !== undefined) return seen;

    const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
    copies.set(value as object, copy);
    for (const [key, item] of Object.entries(value as object)) {
      // defined, not assigned: assigning an own `__proto__` key (JSON.parse
      // makes one) would set the copy's prototype instead of copying it.
      Object.defineProperty(copy, key, {
        value: EventChannel.#snapshot(item, copies),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return Object.freeze(copy);
  }

  readonly #observer: ArazzoRunnerObserver<E> | undefined;
  readonly #now: () => number;

  constructor(options: EventChannelOptions<E>) {
    this.#observer = options.observer;
    this.#now = options.now ?? EventChannel.#DEFAULT_NOW;
  }

  /**
   * This channel while anyone observes it, its own observer or a
   * process-wide one, else `undefined`. Read per event, so hooks registered
   * mid-run apply from the next event on.
   */
  get observed(): EventChannel<E> | undefined {
    return this.#observer !== undefined || isInstrumented() ? this : undefined;
  }

  /**
   * Emits the event. `timestamp` is the clock reading the event describes,
   * when the caller already took one (so a start/settled pair matches a
   * recorded duration exactly); otherwise the clock is read now.
   */
  emit(event: UnstampedEvent<E>, timestamp?: number): void {
    // an absent optional field of the event itself is omitted, never present as
    // undefined; undefined values inside its data (an output that resolved to
    // undefined) are kept.
    const fields = Object.entries(event).filter(([, value]) => value !== undefined);
    const stamped = { ...Object.fromEntries(fields), timestamp: timestamp ?? this.#now() };
    const snapshot = EventChannel.#snapshot(stamped, new WeakMap()) as E;
    this.#observer?.(snapshot);
    notify(snapshot);
  }
}

export default EventChannel;
