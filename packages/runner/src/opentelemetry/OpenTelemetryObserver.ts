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
  type ArazzoRunnerObserver,
  type DocumentLocation,
  type RequestInterceptor,
} from '@usearazzo/runner';

/**
 * Options for {@link openTelemetryObserver}.
 * @public
 */
export interface OpenTelemetryObserverOptions {
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
 * Traces runs as OpenTelemetry spans.
 * @public
 */
export interface OpenTelemetryObserver {
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
   * nothing. Add it as the runner's `requestInterceptor`.
   */
  readonly requestInterceptor: RequestInterceptor;
  /**
   * Ends every span still open. Call it once `execute` settles: a run that
   * throws leaves its workflows and steps without their settled events, so
   * their spans would stay open and never be exported. With an `error`, those
   * spans are marked as failed and record it.
   *
   * It ends the open spans of every run the adapter traces. With concurrent
   * runs, call it once they have all settled, or give each its own runner and
   * adapter.
   */
  end(error?: unknown): void;
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
 * import { openTelemetryObserver } from '@usearazzo/runner/opentelemetry';
 *
 * const otel = openTelemetryObserver();
 * const runner = await ArazzoRunner.load(uri, {
 *   observer: otel.observer,
 *   requestInterceptor: otel.requestInterceptor,
 * });
 * try {
 *   await runner.execute('authenticateAndOrderPet', options);
 *   otel.end();
 * } catch (error) {
 *   otel.end(error);
 *   throw error;
 * }
 * ```
 *
 * A workflow called at the top of a run starts under the context active when
 * its first event arrives, so wrapping `execute` in a span of your own nests
 * the run under it. Spans are told apart by run through the events' `runId`:
 * an operation executor used on its own, without one, is traced as one run, so
 * give concurrent calls a `runId` each.
 * @public
 */
const openTelemetryObserver = (
  options: OpenTelemetryObserverOptions = {},
): OpenTelemetryObserver => {
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

  // a run with nothing open is forgotten
  const release = (runId: string | undefined, spans: OpenSpans): void => {
    if (spans.stack.length === 0 && spans.request === undefined) runs.delete(keyOf(runId));
  };

  // a span's parent is the innermost span open in its run, or the active context
  const start = (spans: OpenSpans, name: string, kind: SpanKind, attributes: Attributes): Span => {
    const parent = spans.stack.at(-1);
    const parentContext =
      parent === undefined ? context.active() : trace.setSpan(context.active(), parent);
    return tracer.startSpan(name, { kind, attributes }, parentContext);
  };

  const push = (runId: string, name: string, attributes: Attributes): void => {
    const spans = spansOf(runId);
    spans.stack.push(start(spans, name, SpanKind.INTERNAL, attributes));
  };

  const settle = (runId: string, failed: boolean, attributes: Attributes): void => {
    const spans = runs.get(keyOf(runId));
    const span = spans?.stack.pop();
    if (spans === undefined || span === undefined) return;
    span.setAttributes(attributes);
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    release(runId, spans);
  };

  // an event of the innermost open span: the step's, for the events below. It
  // names its step, since a retry's stepId reference reports under the
  // referenced step while the retrying step's span is the one open
  const addEvent = (
    event: { readonly runId: string; readonly stepId: string },
    name: string,
    attributes: Attributes,
  ): void => {
    runs
      .get(keyOf(event.runId))
      ?.stack.at(-1)
      ?.addEvent(name, { 'arazzo.step.id': event.stepId, ...attributes });
  };

  const locationAttributes = ({ uri, jsonPointer }: DocumentLocation): Attributes => ({
    'arazzo.document.uri': uri,
    ...(jsonPointer === undefined ? {} : { 'arazzo.document.json_pointer': jsonPointer }),
  });

  // the URL is the one field a span takes that can carry a credential, so it
  // is the only one masked
  const observer: ArazzoRunnerObserver = (event) => {
    switch (event.type) {
      case 'workflow-start':
        push(event.runId, `workflow ${event.workflowId}`, {
          'arazzo.run.id': event.runId,
          'arazzo.workflow.id': event.workflowId,
          'arazzo.workflow.via': event.via,
          ...locationAttributes(event.location),
        });
        return;
      case 'workflow-settled':
        // a transferred workflow did not fail itself: its target reports its own outcome
        settle(event.runId, event.status === 'failed', {
          'arazzo.workflow.status': event.status,
          'arazzo.workflow.settled_status': event.settledStatus,
        });
        return;
      case 'step-start':
        push(event.runId, `step ${event.stepId}`, {
          'arazzo.run.id': event.runId,
          'arazzo.workflow.id': event.workflowId,
          'arazzo.step.id': event.stepId,
          ...locationAttributes(event.location),
        });
        return;
      case 'step-settled':
        settle(event.runId, !event.successful, { 'arazzo.step.attempts': event.attempts });
        return;
      case 'step-attempt':
        addEvent(event, 'attempt', { 'arazzo.step.attempt': event.attempt });
        return;
      case 'criterion-evaluated':
        addEvent(event, 'criterion', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.criterion.kind': event.kind,
          'arazzo.criterion.condition': event.criterion.condition,
          'arazzo.criterion.met': event.criterion.met,
        });
        return;
      case 'action-selected':
        addEvent(event, 'action', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.action.transition': event.transition.kind,
          ...(event.action === undefined
            ? {}
            : { 'arazzo.action.name': String(toValue(event.action.name)) }),
        });
        return;
      case 'retry-wait':
        addEvent(event, 'retry-wait', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.delay_ms': event.delayMs,
        });
        return;
      case 'retry-reference-start':
      case 'retry-reference-settled':
        addEvent(event, event.type, {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.reference.kind': event.kind,
          'arazzo.retry.reference.id': event.id,
          ...(event.type === 'retry-reference-settled'
            ? { 'arazzo.retry.reference.successful': event.successful }
            : {}),
        });
        return;
      case 'openapi-operation-assembled': {
        // started before the request is built, so the request interceptor can
        // propagate this span's context
        const spans = spansOf(event.runId);
        const { documentURI, jsonPointer, operationId } = event.operation;
        spans.request = start(spans, operationId ?? jsonPointer, SpanKind.CLIENT, {
          'arazzo.operation.document_uri': documentURI,
          'arazzo.operation.json_pointer': jsonPointer,
          ...(operationId === undefined ? {} : { 'arazzo.operation.id': operationId }),
        });
        return;
      }
      case 'openapi-operation-request-start': {
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
      case 'openapi-operation-request-settled': {
        const spans = runs.get(keyOf(event.runId));
        const span = spans?.request;
        if (spans === undefined || span === undefined) return;
        span.setAttribute('http.response.status_code', event.response.status);
        if (event.response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        spans.request = undefined;
        release(event.runId, spans);
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

  const end = (error?: unknown): void => {
    const exception = error instanceof Error ? error : String(error);
    const status = {
      code: SpanStatusCode.ERROR,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
    for (const { stack, request } of runs.values()) {
      // innermost first: the request in flight, then the steps and workflows around it
      for (const span of [...stack, ...(request === undefined ? [] : [request])].reverse()) {
        if (error !== undefined) {
          span.recordException(exception);
          span.setStatus(status);
        }
        span.end();
      }
    }
    runs.clear();
  };

  return { observer, requestInterceptor, end };
};

export default openTelemetryObserver;
