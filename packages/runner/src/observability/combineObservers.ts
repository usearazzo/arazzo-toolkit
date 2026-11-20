import type { ArazzoRunnerEvent, ArazzoRunnerObserver } from './ArazzoRunnerEvent.ts';

/**
 * One observer that hands each event to every observer given, in order, so
 * several consumers (a log, a trace, a stream) can watch the same run.
 *
 * Delivery stays synchronous. An observer that throws aborts the run with its
 * error, as any observer does, and the observers after it miss that event.
 * @public
 */
const combineObservers =
  <E extends ArazzoRunnerEvent = ArazzoRunnerEvent>(
    ...observers: readonly ArazzoRunnerObserver<E>[]
  ): ArazzoRunnerObserver<E> =>
  (event) => {
    for (const observer of observers) observer(event);
  };

export default combineObservers;
