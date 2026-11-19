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
import { Redactor, type ArazzoRunnerObserver, type RequestInterceptor } from '@usearazzo/runner';

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
  const runs = new Map<string, OpenSpans>();

  const spansOf = (runId: string | undefined): OpenSpans => {
    const key = runId ?? '';
    let spans = runs.get(key);
    if (spans === undefined) {
      spans = { stack: [] };
      runs.set(key, spans);
    }
    return spans;
  };

  // a span's parent is the innermost span open in its run, or the active context
  const start = (spans: OpenSpans, name: string, kind: SpanKind, attributes: Attributes): Span => {
    const parent = spans.stack.at(-1);
    const parentContext =
      parent === undefined ? context.active() : trace.setSpan(context.active(), parent);
    return tracer.startSpan(name, { kind, attributes }, parentContext);
  };

  const settle = (spans: OpenSpans, runId: string, failed: boolean, attributes: Attributes) => {
    const span = spans.stack.pop();
    if (span === undefined) return;
    span.setAttributes(attributes);
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
    if (spans.stack.length === 0 && spans.request === undefined) runs.delete(runId);
  };

  // the URL is the one field a span takes that can carry a credential, so it
  // is the only one event
  const observer: ArazzoRunnerObserver = (event) => {
    switch (event.type) {
      case 'workflow-start': {
        const spans = spansOf(event.runId);
        spans.stack.push(
          start(spans, `workflow ${event.workflowId}`, SpanKind.INTERNAL, {
            'arazzo.run.id': event.runId,
            'arazzo.workflow.id': event.workflowId,
            'arazzo.workflow.via': event.via,
            'arazzo.document.uri': event.location.uri,
            ...(event.location.jsonPointer === undefined
              ? {}
              : { 'arazzo.document.json_pointer': event.location.jsonPointer }),
          }),
        );
        return;
      }
      case 'workflow-settled':
        // a transferred workflow did not fail itself: its target reports its own outcome
        settle(spansOf(event.runId), event.runId, event.status === 'failed', {
          'arazzo.workflow.status': event.status,
          'arazzo.workflow.settled_status': event.settledStatus,
        });
        return;
      case 'step-start': {
        const spans = spansOf(event.runId);
        spans.stack.push(
          start(spans, `step ${event.stepId}`, SpanKind.INTERNAL, {
            'arazzo.run.id': event.runId,
            'arazzo.workflow.id': event.workflowId,
            'arazzo.step.id': event.stepId,
            'arazzo.document.uri': event.location.uri,
            ...(event.location.jsonPointer === undefined
              ? {}
              : { 'arazzo.document.json_pointer': event.location.jsonPointer }),
          }),
        );
        return;
      }
      case 'step-settled':
        settle(spansOf(event.runId), event.runId, !event.successful, {
          'arazzo.step.attempts': event.attempts,
        });
        return;
      case 'step-attempt':
        spansOf(event.runId)
          .stack.at(-1)
          ?.addEvent('attempt', { 'arazzo.step.attempt': event.attempt });
        return;
      case 'criterion-evaluated':
        spansOf(event.runId).stack.at(-1)?.addEvent('criterion', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.criterion.kind': event.kind,
          'arazzo.criterion.condition': event.criterion.condition,
          'arazzo.criterion.met': event.criterion.met,
        });
        return;
      case 'action-selected':
        spansOf(event.runId)
          .stack.at(-1)
          ?.addEvent('action', {
            'arazzo.step.attempt': event.attempt,
            'arazzo.action.transition': event.transition.kind,
            ...(event.action === undefined
              ? {}
              : { 'arazzo.action.name': String(toValue(event.action.name)) }),
          });
        return;
      case 'retry-wait':
        spansOf(event.runId).stack.at(-1)?.addEvent('retry-wait', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.delay_ms': event.delayMs,
        });
        return;
      case 'retry-reference-start':
      case 'retry-reference-settled':
        spansOf(event.runId)
          .stack.at(-1)
          ?.addEvent(event.type, {
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
        spans.request = start(
          spans,
          event.operation.operationId ?? event.operation.jsonPointer,
          SpanKind.CLIENT,
          {
            'arazzo.operation.document_uri': event.operation.documentURI,
            'arazzo.operation.json_pointer': event.operation.jsonPointer,
            ...(event.operation.operationId === undefined
              ? {}
              : { 'arazzo.operation.id': event.operation.operationId }),
          },
        );
        return;
      }
      case 'openapi-operation-request-start': {
        const span = spansOf(event.runId).request;
        if (span === undefined) return;
        span.updateName(event.request.method);
        span.setAttributes({
          'http.request.method': event.request.method,
          'url.full': redactor.event(event).request.url,
        });
        return;
      }
      case 'openapi-operation-request-settled': {
        const spans = spansOf(event.runId);
        const span = spans.request;
        if (span === undefined) return;
        span.setAttribute('http.response.status_code', event.response.status);
        if (event.response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        spans.request = undefined;
        if (spans.stack.length === 0) runs.delete(event.runId ?? '');
        return;
      }
      default:
        return;
    }
  };

  const requestInterceptor: RequestInterceptor = (request, requestContext) => {
    const span = runs.get(requestContext.runId ?? '')?.request;
    if (span === undefined) return;
    propagation.inject(trace.setSpan(context.active(), span), request.headers);
  };

  const end = (error?: unknown): void => {
    for (const spans of runs.values()) {
      const open = [...spans.stack, ...(spans.request === undefined ? [] : [spans.request])];
      for (const span of open.reverse()) {
        if (error !== undefined) {
          span.recordException(error instanceof Error ? error : String(error));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            ...(error instanceof Error ? { message: error.message } : {}),
          });
        }
        span.end();
      }
    }
    runs.clear();
  };

  return { observer, requestInterceptor, end };
};

export default openTelemetryObserver;
