import type { ArazzoRunnerEvent, ArazzoRunnerObserver } from './ArazzoRunnerEvent.ts';

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
 * Delivers a building block's events to its observer: stamps each with the
 * block's clock and hands it over synchronously, without awaiting anything.
 * With no observer it does nothing, not even read the clock.
 * @internal
 */
class EventChannel<E extends ArazzoRunnerEvent> {
  static readonly #DEFAULT_NOW = (): number => performance.now();

  readonly #observer: ArazzoRunnerObserver<E> | undefined;
  readonly #now: () => number;

  constructor(options: EventChannelOptions<E> = {}) {
    this.#observer = options.observer;
    this.#now = options.now ?? EventChannel.#DEFAULT_NOW;
  }

  /**
   * Emits the event. `timestamp` is the clock reading the event describes,
   * when the caller already took one (so a start/settled pair matches a
   * recorded duration exactly); otherwise the clock is read now.
   */
  emit(event: UnstampedEvent<E>, timestamp?: number): void {
    if (this.#observer === undefined) return;
    this.#observer({ ...event, timestamp: timestamp ?? this.#now() } as unknown as E);
  }
}

export default EventChannel;
