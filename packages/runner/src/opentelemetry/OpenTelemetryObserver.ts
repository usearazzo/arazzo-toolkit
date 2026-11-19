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
   * Masks each event before it becomes span data. A `new Redactor()` with the
   * default field patterns when omitted; there is no way to export unmasked
   * events through this adapter.
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
   * Propagates the trace context into each request (a `traceparent` header
   * with the default W3C propagator), so the API's own spans join the run's
   * trace under the request's span. Add it as the runner's
   * `requestInterceptor`.
   */
  readonly requestInterceptor: RequestInterceptor;
  /**
   * Ends every span still open. Call it once `execute` settles: a run that
   * throws leaves its workflows and steps without their settled events, so
   * their spans would stay open and never be exported. With an `error`, those
   * spans are marked as failed and record it.
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
 * the run under it.
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

  const observer: ArazzoRunnerObserver = (event) => {
    const masked: ArazzoRunnerEvent = redactor.event(event);
    switch (masked.type) {
      case 'workflow-start': {
        const spans = spansOf(masked.runId);
        spans.stack.push(
          start(spans, `workflow ${masked.workflowId}`, SpanKind.INTERNAL, {
            'arazzo.run.id': masked.runId,
            'arazzo.workflow.id': masked.workflowId,
            'arazzo.workflow.via': masked.via,
            'arazzo.document.uri': masked.location.uri,
            ...(masked.location.jsonPointer === undefined
              ? {}
              : { 'arazzo.document.json_pointer': masked.location.jsonPointer }),
          }),
        );
        return;
      }
      case 'workflow-settled':
        settle(spansOf(masked.runId), masked.runId, masked.settledStatus === 'failed', {
          'arazzo.workflow.status': masked.status,
          'arazzo.workflow.settled_status': masked.settledStatus,
        });
        return;
      case 'step-start': {
        const spans = spansOf(masked.runId);
        spans.stack.push(
          start(spans, `step ${masked.stepId}`, SpanKind.INTERNAL, {
            'arazzo.run.id': masked.runId,
            'arazzo.workflow.id': masked.workflowId,
            'arazzo.step.id': masked.stepId,
            'arazzo.document.uri': masked.location.uri,
            ...(masked.location.jsonPointer === undefined
              ? {}
              : { 'arazzo.document.json_pointer': masked.location.jsonPointer }),
          }),
        );
        return;
      }
      case 'step-settled':
        settle(spansOf(masked.runId), masked.runId, !masked.successful, {
          'arazzo.step.attempts': masked.attempts,
        });
        return;
      case 'step-attempt':
        spansOf(masked.runId)
          .stack.at(-1)
          ?.addEvent('attempt', { 'arazzo.step.attempt': masked.attempt });
        return;
      case 'criterion-evaluated':
        spansOf(masked.runId).stack.at(-1)?.addEvent('criterion', {
          'arazzo.step.attempt': masked.attempt,
          'arazzo.criterion.kind': masked.kind,
          'arazzo.criterion.condition': masked.criterion.condition,
          'arazzo.criterion.met': masked.criterion.met,
        });
        return;
      case 'action-selected':
        spansOf(masked.runId)
          .stack.at(-1)
          ?.addEvent('action', {
            'arazzo.step.attempt': masked.attempt,
            'arazzo.action.transition': masked.transition.kind,
            ...(masked.action === undefined
              ? {}
              : { 'arazzo.action.name': String(toValue(masked.action.name)) }),
          });
        return;
      case 'retry-wait':
        spansOf(masked.runId).stack.at(-1)?.addEvent('retry-wait', {
          'arazzo.step.attempt': masked.attempt,
          'arazzo.retry.delay_ms': masked.delayMs,
        });
        return;
      case 'retry-reference-start':
      case 'retry-reference-settled':
        spansOf(masked.runId)
          .stack.at(-1)
          ?.addEvent(masked.type, {
            'arazzo.step.attempt': masked.attempt,
            'arazzo.retry.reference.kind': masked.kind,
            'arazzo.retry.reference.id': masked.id,
            ...(masked.type === 'retry-reference-settled'
              ? { 'arazzo.retry.reference.successful': masked.successful }
              : {}),
          });
        return;
      case 'openapi-operation-assembled': {
        // started before the request is built, so the request interceptor can
        // propagate this span's context
        const spans = spansOf(masked.runId);
        spans.request = start(
          spans,
          masked.operation.operationId ?? masked.operation.jsonPointer,
          SpanKind.CLIENT,
          {
            'arazzo.operation.document_uri': masked.operation.documentURI,
            'arazzo.operation.json_pointer': masked.operation.jsonPointer,
            ...(masked.operation.operationId === undefined
              ? {}
              : { 'arazzo.operation.id': masked.operation.operationId }),
          },
        );
        return;
      }
      case 'openapi-operation-request-start': {
        const span = spansOf(masked.runId).request;
        span?.updateName(masked.request.method);
        span?.setAttributes({
          'http.request.method': masked.request.method,
          'url.full': masked.request.url,
        });
        return;
      }
      case 'openapi-operation-request-settled': {
        const spans = spansOf(masked.runId);
        const span = spans.request;
        if (span === undefined) return;
        span.setAttribute('http.response.status_code', masked.response.status);
        if (masked.response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        spans.request = undefined;
        if (spans.stack.length === 0) runs.delete(masked.runId ?? '');
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
