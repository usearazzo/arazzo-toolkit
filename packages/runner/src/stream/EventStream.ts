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
   * read it or iterate this object, not both; `tee()` it for two.
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
 * Turns a run's events into a stream. The run cannot end it itself (one
 * that throws leaves its workflows unsettled), so the caller ends it:
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
  // queued after the last event by error(), so the events before it are still read
  const failure = Symbol('failure');
  let reason: unknown;
  let controller!: ReadableStreamDefaultController<ArazzoRunnerEvent | typeof failure>;
  let open = true;

  const source = new ReadableStream<ArazzoRunnerEvent | typeof failure>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      open = false;
    },
  });
  const stream = source.pipeThrough(
    new TransformStream<ArazzoRunnerEvent | typeof failure, ArazzoRunnerEvent>({
      transform(chunk, output) {
        if (chunk === failure) output.error(reason);
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
    error: (cause) => {
      if (!open) return;
      open = false;
      reason = cause;
      controller.enqueue(failure);
      controller.close();
    },
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        // a consumer that breaks out early cancels the stream, ending the queuing;
        // a stream already closed or failed has nothing left to cancel
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
};

export default eventStream;
