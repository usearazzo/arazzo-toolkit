import {
  context,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Span,
  type Tracer,
  type TracerProvider,
} from '@opentelemetry/api';
import { toValue } from '@speclynx/apidom-core';
import {
  instrument,
  type ArazzoRunnerEvent,
  type DocumentLocation,
  type InstrumentationWrap,
  type InstrumentedOperation,
} from '@usearazzo/runner';

import pkg from '../../../package.json' with { type: 'json' };

/**
 * Configuration of {@link ArazzoRunnerInstrumentation}, OpenTelemetry's
 * `InstrumentationConfig`.
 * @public
 */
export interface ArazzoRunnerInstrumentationConfig {
  /** Whether it is enabled once constructed. `true` when omitted. */
  readonly enabled?: boolean;
}

const NAME = '@usearazzo/runner';

const locationAttributes = ({ uri, jsonPointer }: DocumentLocation): Attributes => ({
  'arazzo.document.uri': uri,
  ...(jsonPointer === undefined ? {} : { 'arazzo.document.json_pointer': jsonPointer }),
});

const spanOf = (operation: InstrumentedOperation): { name: string; attributes: Attributes } =>
  operation.kind === 'workflow'
    ? {
        name: `workflow ${operation.workflowId}`,
        attributes: {
          'arazzo.run.id': operation.runId,
          'arazzo.workflow.id': operation.workflowId,
          'arazzo.workflow.via': operation.via,
          ...locationAttributes(operation.location),
        },
      }
    : {
        name: `step ${operation.stepId}`,
        attributes: {
          'arazzo.run.id': operation.runId,
          'arazzo.workflow.id': operation.workflowId,
          'arazzo.step.id': operation.stepId,
          ...locationAttributes(operation.location),
        },
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

/**
 * Traces every runner in the process with OpenTelemetry, as an OpenTelemetry
 * instrumentation: list it with the others, and no runner needs wiring.
 *
 * ```js
 * import { NodeSDK } from '@opentelemetry/sdk-node';
 * import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
 * import { ArazzoRunnerInstrumentation } from '@usearazzo/runner/observability/opentelemetry';
 *
 * new NodeSDK({
 *   instrumentations: [getNodeAutoInstrumentations(), new ArazzoRunnerInstrumentation()],
 * }).start();
 * ```
 *
 * In the browser, with the fetch instrumentation for the request spans:
 *
 * ```js
 * import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
 * import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
 * import { ZoneContextManager } from '@opentelemetry/context-zone';
 * import { registerInstrumentations } from '@opentelemetry/instrumentation';
 * import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
 * import { ArazzoRunnerInstrumentation } from '@usearazzo/runner/observability/opentelemetry';
 *
 * const provider = new WebTracerProvider({
 *   spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
 * });
 * provider.register({ contextManager: new ZoneContextManager() });
 * registerInstrumentations({
 *   // propagateTraceHeaderCorsUrls: the cross-origin APIs that get a traceparent
 *   instrumentations: [
 *     new FetchInstrumentation({ propagateTraceHeaderCorsUrls: [/api\.example\.com/] }),
 *     new ArazzoRunnerInstrumentation(),
 *   ],
 * });
 * ```
 *
 * Each workflow invocation and each step is an `INTERNAL` span, the step's
 * under its workflow's, a sub-workflow's under its step's. Attempts, criteria,
 * selected actions, retry waits, retry references and the operations a step
 * calls are events of the step's span. A step runs in its span's context, so
 * the HTTP instrumentation of the client it sends with (undici for Node's
 * `fetch`, `@opentelemetry/instrumentation-fetch` in the browser) nests its
 * request spans under the step and propagates the trace into the API.
 *
 * In the browser, the workflow and step spans keep their tree with any
 * context manager, but request spans nest under the step only where the
 * context survives an `await`: zone.js loses it across a native one, so
 * transpile `async`/`await` as OpenTelemetry's web instrumentation asks.
 *
 * Spans carry the identifiers and outcomes of the run, not its data: no
 * inputs, outputs, criterion values or requests. A step or workflow that
 * throws records the error, whose message can quote what the run saw.
 * @public
 */
class ArazzoRunnerInstrumentation {
  readonly instrumentationName = NAME;
  readonly instrumentationVersion: string = pkg.version;

  #config: ArazzoRunnerInstrumentationConfig;
  #tracer: Tracer;
  #remove: (() => void) | undefined;
  // the operation each span traces: an event's active span is acted on only
  // when it is this instrumentation's own
  readonly #operations = new WeakMap<Span, InstrumentedOperation>();
  // the spans each run has open, outermost first: a run's operations are
  // sequential, so the innermost is the parent of the next
  readonly #runs = new Map<string, Span[]>();

  constructor(config: ArazzoRunnerInstrumentationConfig = {}) {
    this.#config = { ...config, enabled: config.enabled ?? true };
    this.#tracer = trace.getTracer(this.instrumentationName, this.instrumentationVersion);
    if (this.#config.enabled) this.enable();
  }

  /** Starts tracing every runner in the process. */
  enable(): void {
    this.#remove ??= instrument({ wrap: this.#wrap, observer: this.#observe });
  }

  /** Stops tracing; runs in progress stop at their next workflow or step. */
  disable(): void {
    this.#remove?.();
    this.#remove = undefined;
  }

  setTracerProvider(tracerProvider: TracerProvider): void {
    this.#tracer = tracerProvider.getTracer(this.instrumentationName, this.instrumentationVersion);
  }

  /** Records no metrics. */
  setMeterProvider(): void {}

  setConfig(config: ArazzoRunnerInstrumentationConfig): void {
    this.#config = { ...config, enabled: config.enabled ?? true };
  }

  getConfig(): ArazzoRunnerInstrumentationConfig {
    return this.#config;
  }

  // the span of the operation, made the active context for everything it
  // does. Its parent is the innermost span open in its run, so the run's tree
  // holds with a context manager that loses context across a native await
  // (zone.js in the browser); the run's root takes the active context
  readonly #wrap: InstrumentationWrap = async (operation, run) => {
    const open = this.#runs.get(operation.runId) ?? [];
    this.#runs.set(operation.runId, open);
    const parent = open.at(-1);
    const parentContext =
      parent === undefined ? context.active() : trace.setSpan(context.active(), parent);
    const { name, attributes } = spanOf(operation);
    const span = this.#tracer.startSpan(
      name,
      { kind: SpanKind.INTERNAL, attributes },
      parentContext,
    );
    this.#operations.set(span, operation);
    open.push(span);
    try {
      await context.with(trace.setSpan(parentContext, span), run);
    } finally {
      // by identity: an operation settling out of order must not pop another's span
      open.splice(open.lastIndexOf(span), 1);
      if (open.length === 0) this.#runs.delete(operation.runId);
      span.end();
    }
  };

  // the span of the operation of `kind` the event belongs to: the innermost
  // open in its run, read from the run rather than the active context for the
  // same reason as the parents above
  #active(
    event: { readonly runId?: string },
    kind: InstrumentedOperation['kind'],
  ): Span | undefined {
    const span = event.runId === undefined ? undefined : this.#runs.get(event.runId)?.at(-1);
    return span !== undefined && this.#operations.get(span)?.kind === kind ? span : undefined;
  }

  readonly #observe = (event: ArazzoRunnerEvent): void => {
    switch (event.type) {
      case 'workflow:settled': {
        const span = this.#active(event, 'workflow');
        if (span === undefined) return;
        span.setAttributes({
          'arazzo.workflow.status': event.status,
          'arazzo.workflow.settled_status': event.settledStatus,
        });
        // a transferred workflow did not fail itself: its target reports its own outcome
        if (event.status === 'failed' || event.error !== undefined) fail(span, event.error);
        return;
      }
      case 'step:settled': {
        const span = this.#active(event, 'step');
        if (span === undefined) return;
        span.setAttribute('arazzo.step.attempts', event.attempts);
        if (!event.successful || event.error !== undefined) fail(span, event.error);
        return;
      }
      case 'step:attempt':
        this.#addEvent(event, 'attempt', { 'arazzo.step.attempt': event.attempt });
        return;
      case 'criterion:evaluated':
        this.#addEvent(event, 'criterion', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.criterion.kind': event.kind,
          'arazzo.criterion.condition': event.criterion.condition,
          'arazzo.criterion.met': event.criterion.met,
        });
        return;
      case 'action:selected':
        this.#addEvent(event, 'action', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.action.transition': event.transition.kind,
          ...(event.action === undefined
            ? {}
            : { 'arazzo.action.name': String(toValue(event.action.name)) }),
        });
        return;
      case 'retry:wait':
        this.#addEvent(event, 'retry:wait', {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.delay_ms': event.delayMs,
        });
        return;
      case 'retry:reference:start':
      case 'retry:reference:settled':
        this.#addEvent(event, event.type, {
          'arazzo.step.attempt': event.attempt,
          'arazzo.retry.reference.kind': event.kind,
          'arazzo.retry.reference.id': event.id,
          ...(event.type === 'retry:reference:settled'
            ? { 'arazzo.retry.reference.successful': event.successful }
            : {}),
        });
        return;
      case 'openapi:operation:assembled': {
        // an operation executor used on its own runs for no step
        if (event.step === undefined) return;
        const { documentURI, jsonPointer, operationId } = event.operation;
        this.#addEvent({ ...event.step, runId: event.runId }, 'operation', {
          'arazzo.operation.document_uri': documentURI,
          'arazzo.operation.json_pointer': jsonPointer,
          ...(operationId === undefined ? {} : { 'arazzo.operation.id': operationId }),
        });
        return;
      }
      default:
        return;
    }
  };

  // an event of the step's span. It names its step, since a retry's stepId
  // reference reports under the referenced step within the retrying step
  #addEvent(
    event: { readonly runId?: string; readonly stepId: string },
    name: string,
    attributes: Attributes,
  ): void {
    this.#active(event, 'step')?.addEvent(name, { 'arazzo.step.id': event.stepId, ...attributes });
  }
}

export default ArazzoRunnerInstrumentation;
