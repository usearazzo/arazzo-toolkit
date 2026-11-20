import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { toValue } from '@speclynx/apidom-core';
import {
  Redactor,
  type ArazzoRunnerEvent,
  type ArazzoRunnerObserver,
  type DocumentLocation,
  type RequestInterceptor,
} from '@usearazzo/runner';

/**
 * Options for {@link openTelemetryTracing}.
 * @public
 */
export interface OpenTelemetryTracingOptions {
  /**
   * The tracer the spans are started with. `trace.getTracer('@usearazzo/runner')`
   * when omitted, so spans go to the tracer provider registered globally.
   */
  readonly tracer?: Tracer;
  /**
   * Masks the request URL before it becomes `url.full`, the one span attribute
   * that can carry a credential. A `new Redactor()` with the default field
   * patterns when omitted; there is no way to export an unmasked URL through
   * this adapter.
   */
  readonly redactor?: Redactor;
}

/**
 * Traces runs: an observer and a request interceptor, to pass as the
 * runner's `observer` and `requestInterceptor`.
 * @public
 */
export interface OpenTelemetryTracing {
  /**
   * Turns events into spans: one per workflow, one per step under it, and
   * one `CLIENT` span per request under its step. Attempts, criteria, selected
   * actions, retry waits and retry references are events of their step's span.
   */
  readonly observer: ArazzoRunnerObserver;
  /**
   * Propagates the trace context into each request through the propagator
   * registered globally (a `traceparent` header with W3C trace context, which
   * the Node SDK registers by default), so the API's own spans join the run's
   * trace under the request's span. Without a registered propagator it adds
   * nothing. The runner takes one interceptor: with one of your own, call
   * this one from it.
   */
  readonly requestInterceptor: RequestInterceptor;
}

/**
 * The spans of one run still open: its workflows and steps outermost first,
 * and the request in flight.
 */
interface OpenSpans {
  readonly stack: Span[];
  request?: Span;
}

const NAME = '@usearazzo/runner';

/**
 * Traces runs with OpenTelemetry. It depends only on `@opentelemetry/api`,
 * an optional peer dependency: without an SDK registered, the spans are
 * no-ops.
 *
 * ```js
 * import { ArazzoRunner } from '@usearazzo/runner';
 * import { openTelemetryTracing } from '@usearazzo/runner/opentelemetry';
 *
 * const tracing = openTelemetryTracing();
 * const runner = await ArazzoRunner.load(uri, {
 *   observer: tracing.observer,
 *   requestInterceptor: tracing.requestInterceptor,
 * });
 * await runner.execute('authenticateAndOrderPet', options);
 * ```
 *
 * Every span ends with its settled event, a run that throws included: its
 * workflows and steps, and a request whose transport threw, end marked as
 * failed, recording the error. Spans are timed by the events' timestamps,
 * the runner's `now`.
 *
 * A workflow called at the top of a run starts under the context active when
 * its first event arrives, so wrapping `execute` in a span of your own nests
 * the run under it. Spans are told apart by run through the events' `runId`:
 * an operation executor used on its own, without one, is traced as one run, so
 * give concurrent calls a `runId` each.
 *
 * HTTP auto-instrumentation (`@opentelemetry/instrumentation-undici`, which
 * the Node auto-instrumentations enable, and which instruments the `fetch` the
 * runner sends with by default) adds a `CLIENT` span of its own to each
 * request, outside the run's trace, and replaces the `traceparent` this
 * adapter propagates with its own. Turn it off for the runner's requests to
 * keep one span per request in the run's trace: with
 * `OTEL_NODE_DISABLED_INSTRUMENTATIONS=undici`, or
 * `getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-undici': { enabled: false } })`.
 * @public
 */
const openTelemetryTracing = (options: OpenTelemetryTracingOptions = {}): OpenTelemetryTracing => {
  const tracer = options.tracer ?? trace.getTracer(NAME);
  const redactor = options.redactor ?? new Redactor();
  // keyed by runId: an executor used without one is traced as the run ''
  const runs = new Map<string, OpenSpans>();
  const keyOf = (runId: string | undefined): string => runId ?? '';

  const spansOf = (runId: string | undefined): OpenSpans => {
    const key = keyOf(runId);
    let spans = runs.get(key);
    if (spans === undefined) {
      spans = { stack: [] };
      runs.set(key, spans);
    }
    return spans;
  };

  // a span's parent is the innermost span open in its run, or the active context
  const start = (
    spans: OpenSpans,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    startTime: number,
  ): Span => {
    const parent = spans.stack.at(-1);
    const parentContext =
      parent === undefined ? context.active() : trace.setSpan(context.active(), parent);
    return tracer.startSpan(name, { kind, attributes, startTime }, parentContext);
  };

  const fail = (span: Span, error: unknown): void => {
    if (error === undefined) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      return;
    }
    span.recordException(error instanceof Error ? error : String(error));
    span.setStatus({
      code: SpanStatusCode.ERROR,
      ...(error instanceof Error ? { message: error.message } : {}),
    });
  };

  const push = (
    event: { readonly runId: string; readonly timestamp: number },
    name: string,
    attributes: Attributes,
  ): void => {
    const spans = spansOf(event.runId);
    spans.stack.push(start(spans, name, SpanKind.INTERNAL, attributes, event.timestamp));
  };

  // a request still open when its step settles threw in the transport
  const settle = (
    event: { readonly runId: string; readonly timestamp: number; readonly error?: unknown },
    failed: boolean,
    attributes: Attributes,
  ): void => {
    const key = keyOf(event.runId);
    const spans = runs.get(key);
    const span = spans?.stack.pop();
    if (spans === undefined || span === undefined) return;
    if (spans.request !== undefined) {
      fail(spans.request, event.error);
      spans.request.end(event.timestamp);
      spans.request = undefined;
    }
    span.setAttributes(attributes);
    if (failed || event.error !== undefined) fail(span, event.error);
    span.end(event.timestamp);
    // a run with nothing open is forgotten
    if (spans.stack.length === 0) runs.delete(key);
  };

  // an event of the innermost open span: the step's, for the events below. It
  // names its step, since a retry's stepId reference reports under the
  // referenced step while the retrying step's span is the one open
  const addEvent = (
    event: { readonly runId: string; readonly stepId: string; readonly timestamp: number },
    name: string,
    attributes: Attributes,
  ): void => {
    runs
      .get(keyOf(event.runId))
      ?.stack.at(-1)
      ?.addEvent(name, { 'arazzo.step.id': event.stepId, ...attributes }, event.timestamp);
  };

  const locationAttributes = ({ uri, jsonPointer }: DocumentLocation): Attributes => ({
    'arazzo.document.uri': uri,
    ...(jsonPointer === undefined ? {} : { 'arazzo.document.json_pointer': jsonPointer }),
  });

  // the URL is the one field a span takes that can carry a credential, so it
  // is the only one masked
  const observer: ArazzoRunnerObserver = (event: ArazzoRunnerEvent) => {
    switch (event.type) {
      case 'workflow:start':
        push(event, `workflow ${event.workflowId}`, {
          'arazzo.run.id': event.runId,
          'arazzo.workflow.id': event.workflowId,
          'arazzo.workflow.via': event.via,
          ...locationAttributes(event.location),
        });
        return;
      case 'workflow:settled':
        // a transferred workflow did not fail itself: its target reports its own outcome
        settle(event, event.status === 'failed', {
          'arazzo.workflow.status': event.status,
          'arazzo.workflow.settled_status': event.settledStatus,
        });
        return;
      case 'step:start':
        push(event, `step ${event.stepId}`, {
          'arazzo.run.id': event.runId,
          'arazzo.workflow.id': event.workflowId,
          'arazzo.step.id': event.stepId,
          ...locationAttributes(event.location),
        });
        return;
      case 'step:settled':
        settle(event, !event.successful, { 'arazzo.step.attempts': event.attempts });
        return;
      case 'step:attempt':
        addEvent(event, 'attempt', { 'arazzo.step.attempt': event.attempt });
        return;
      case 'criterion:evaluated':
        addEvent(event, 'criterion', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.criterion.kind': event.kind,
          'arazzo.criterion.condition': event.criterion.condition,
          'arazzo.criterion.met': event.criterion.met,
        });
        return;
      case 'action:selected':
        addEvent(event, 'action', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.action.transition': event.transition.kind,
          ...(event.action === undefined
            ? {}
            : { 'arazzo.action.name': String(toValue(event.action.name)) }),
        });
        return;
      case 'retry:wait':
        addEvent(event, 'retry:wait', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.delay_ms': event.delayMs,
        });
        return;
      case 'retry:reference:start':
      case 'retry:reference:settled':
        addEvent(event, event.type, {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.reference.kind': event.kind,
          'arazzo.retry.reference.id': event.id,
          ...(event.type === 'retry:reference:settled'
            ? { 'arazzo.retry.reference.successful': event.successful }
            : {}),
        });
        return;
      case 'openapi:operation:assembled': {
        // started before the request is built, so the request interceptor can
        // propagate this span's context
        const spans = spansOf(event.runId);
        const { documentURI, jsonPointer, operationId } = event.operation;
        spans.request = start(
          spans,
          operationId ?? jsonPointer,
          SpanKind.CLIENT,
          {
            'arazzo.operation.document_uri': documentURI,
            'arazzo.operation.json_pointer': jsonPointer,
            ...(operationId === undefined ? {} : { 'arazzo.operation.id': operationId }),
          },
          event.timestamp,
        );
        return;
      }
      case 'openapi:operation:request:start': {
        const span = runs.get(keyOf(event.runId))?.request;
        if (span === undefined) return;
        span.updateName(event.request.method);
        span.setAttributes({
          'http.request.method': event.request.method,
          // only the URL is masked: headers and a captured body are not walked
          'url.full': redactor.event({
            ...event,
            request: { ...event.request, headers: {}, body: undefined },
          }).request.url,
        });
        return;
      }
      case 'openapi:operation:request:settled': {
        const key = keyOf(event.runId);
        const spans = runs.get(key);
        const span = spans?.request;
        if (spans === undefined || span === undefined) return;
        span.setAttribute('http.response.status_code', event.response.status);
        if (event.response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end(event.timestamp);
        spans.request = undefined;
        if (spans.stack.length === 0) runs.delete(key);
        return;
      }
      default:
        return;
    }
  };

  const requestInterceptor: RequestInterceptor = (request, requestContext) => {
    const span = runs.get(keyOf(requestContext.runId))?.request;
    if (span === undefined) return;
    propagation.inject(trace.setSpan(context.active(), span), request.headers);
  };

  return { observer, requestInterceptor };
};

export default openTelemetryTracing;
