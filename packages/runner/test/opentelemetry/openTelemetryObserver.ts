import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import { ArazzoRunner, type HTTPClient } from '../../src/index.ts';
import { openTelemetryObserver } from '../../src/opentelemetry/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const trace = async (
  workflowId: string,
  status: number,
): Promise<{ spans: ReadableSpan[]; headers: Record<string, string>[]; thrown?: unknown }> => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const otel = openTelemetryObserver({ tracer: provider.getTracer('test') });
  const headers: Record<string, string>[] = [];
  const httpClient: HTTPClient = async (request) => {
    headers.push({ ...request.headers });
    return new Response(JSON.stringify({ id: 7 }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const runner = await ArazzoRunner.load(entryPath, {
    httpClient,
    observer: otel.observer,
    requestInterceptor: otel.requestInterceptor,
  });

  let thrown: unknown;
  try {
    await runner.execute(workflowId, { inputs: { status: 'available' } });
    otel.end();
  } catch (error) {
    thrown = error;
    otel.end(error);
  }
  return { spans: exporter.getFinishedSpans(), headers, thrown };
};

const named = (spans: ReadableSpan[], name: string): ReadableSpan => {
  const span = spans.find((candidate) => candidate.name === name);
  assert.isDefined(span, name);
  return span!;
};

const isChild = (child: ReadableSpan, parent: ReadableSpan): boolean =>
  child.parentSpanContext?.spanId === parent.spanContext().spanId;

describe('openTelemetryObserver', function () {
  afterEach(function () {
    propagation.disable();
  });

  specify('should nest request spans under step spans under workflow spans', async function () {
    const { spans } = await trace('linear', 200);

    const workflow = named(spans, 'workflow linear');
    const step = named(spans, 'step findPets');
    const request = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    assert.isTrue(isChild(step, workflow));
    assert.isTrue(isChild(request, step));
    assert.strictEqual(request.name, 'GET');
    assert.strictEqual(request.attributes['http.request.method'], 'GET');
    assert.strictEqual(request.attributes['http.response.status_code'], 200);
    assert.include(String(request.attributes['url.full']), '/pet/findByStatus?status=available');
    assert.deepEqual(
      step.events.map((event) => event.name),
      ['attempt', 'criterion', 'action'],
    );
  });

  specify('should mark a failed step, workflow and request as errors', async function () {
    const { spans } = await trace('linear', 500);

    assert.strictEqual(named(spans, 'workflow linear').status.code, SpanStatusCode.ERROR);
    assert.strictEqual(named(spans, 'step findPets').status.code, SpanStatusCode.ERROR);
    const request = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    assert.strictEqual(request.status.code, SpanStatusCode.ERROR);
  });

  specify('should mark only the failed target of a transfer as an error', async function () {
    const { spans } = await trace('transfersToTarget', 500);

    assert.strictEqual(
      named(spans, 'workflow transfersToTarget').status.code,
      SpanStatusCode.UNSET,
    );
    assert.strictEqual(named(spans, 'workflow transferTarget').status.code, SpanStatusCode.ERROR);
  });

  specify('should end the spans of a run that throws with its error', async function () {
    const { spans, thrown } = await trace('noSuchWorkflow', 200);

    assert.isDefined(thrown);
    // the root workflow id is rejected before it starts, so nothing is open
    assert.isEmpty(spans);

    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const otel = openTelemetryObserver({ tracer: provider.getTracer('test') });
    otel.observer({
      type: 'workflow-start',
      timestamp: 0,
      runId: 'run-1',
      workflowId: 'w',
      path: ['w'],
      via: 'root',
      location: { uri: 'flow.arazzo.yaml', jsonPointer: '/workflows/0' },
    });
    otel.end(new Error('boom'));

    const [workflow] = exporter.getFinishedSpans();
    assert.strictEqual(workflow.status.code, SpanStatusCode.ERROR);
    assert.strictEqual(workflow.status.message, 'boom');
    assert.strictEqual(workflow.events[0].name, 'exception');
  });

  specify("should propagate the request span's context into the request", async function () {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    const { spans, headers } = await trace('linear', 200);

    const request = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    const { traceId, spanId } = request.spanContext();
    assert.strictEqual(headers[0].traceparent, `00-${traceId}-${spanId}-01`);
  });
});
