import { Redactor, type ArazzoRunnerEvent, type ArazzoRunnerObserver } from '@usearazzo/runner';

/**
 * Options for {@link eventStream}.
 * @public
 */
export interface EventStreamOptions {
  /**
   * Masks each event before it is queued. A `new Redactor()` with the default
   * field patterns when omitted; there is no way to stream unmasked events
   * through this adapter.
   */
  readonly redactor?: Redactor;
}

/**
 * A run's events as a stream: wire `observer` into the runner, read the
 * events with `for await`, or pipe `stream`, and end it with `close` or
 * `error` once the run settles.
 * @public
 */
export interface EventStream extends AsyncIterable<ArazzoRunnerEvent> {
  /**
   * Queues each event, masked. It never waits for the consumer, so a slow
   * consumer cannot hold the run back: events wait in an unbounded queue.
   */
  readonly observer: ArazzoRunnerObserver;
  /**
   * The events as a WHATWG `ReadableStream`, for piping. It has one consumer:
   * read it or iterate this object, not both. For two consumers, give each
   * an `eventStream()` of its own behind `combineObservers`: a `tee()`d
   * branch loses its unread events when the stream fails.
   */
  readonly stream: ReadableStream<ArazzoRunnerEvent>;
  /**
   * Ends the stream once the queued events are read. Call it when `execute`
   * resolves; events after it are dropped.
   */
  close(): void;
  /**
   * Fails the stream once the queued events are read: reading it then rejects
   * with `reason`. Call it when `execute` rejects; events after it are
   * dropped.
   */
  error(reason: unknown): void;
}

/**
 * Queued after the last event by `error()`, so the events before it are
 * still read.
 */
interface Failure {
  readonly failure: unknown;
}

const isFailure = (chunk: ArazzoRunnerEvent | Failure): chunk is Failure => 'failure' in chunk;

/**
 * Turns a run's events into a stream. The caller ends it: a runner can run
 * many times into one stream, and an `execute` that fails before its
 * workflow starts (an unknown workflow, a document that does not load)
 * emits no workflow event to end it on:
 *
 * ```js
 * import { ArazzoRunner } from '@usearazzo/runner';
 * import { eventStream } from '@usearazzo/runner/stream';
 *
 * const events = eventStream();
 * const runner = await ArazzoRunner.load(uri, { observer: events.observer });
 * runner.execute('authenticateAndOrderPet', options).then(events.close, events.error);
 *
 * for await (const event of events) render(event);
 * ```
 *
 * A consumer that stops reading early (a `break` out of `for await`, or a
 * cancelled stream) stops the queuing: the run goes on unobserved.
 * @public
 */
const eventStream = (options: EventStreamOptions = {}): EventStream => {
  const redactor = options.redactor ?? new Redactor();
  let controller!: ReadableStreamDefaultController<ArazzoRunnerEvent | Failure>;
  let open = true;

  const stream = new ReadableStream<ArazzoRunnerEvent | Failure>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      open = false;
    },
  }).pipeThrough(
    new TransformStream<ArazzoRunnerEvent | Failure, ArazzoRunnerEvent>({
      transform(chunk, output) {
        if (isFailure(chunk)) output.error(chunk.failure);
        else output.enqueue(chunk);
      },
    }),
  );

  return {
    observer: (event) => {
      if (open) controller.enqueue(redactor.event(event));
    },
    stream,
    close: () => {
      if (!open) return;
      open = false;
      controller.close();
    },
    error: (reason) => {
      if (!open) return;
      open = false;
      controller.enqueue({ failure: reason });
      controller.close();
    },
    // a consumer that breaks out early cancels the stream, ending the queuing
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
  };
};

export default eventStream;
