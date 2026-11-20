import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { propagation, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { hrTimeToMilliseconds, W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import {
  ArazzoRunner,
  combineObservers,
  type ArazzoRunnerEvent,
  type HTTPClient,
} from '../../src/index.ts';
import { openTelemetryTracing } from '../../src/opentelemetry/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const respond =
  (status: number, headers: Record<string, string>[]): HTTPClient =>
  async (request) => {
    headers.push({ ...request.headers });
    return new Response(JSON.stringify({ id: 7 }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

const trace = async (
  workflowId: string,
  status: number,
  httpClient?: HTTPClient,
): Promise<{
  spans: ReadableSpan[];
  events: ArazzoRunnerEvent[];
  headers: Record<string, string>[];
  thrown?: unknown;
}> => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const otel = openTelemetryTracing({ tracer: provider.getTracer('test') });
  const headers: Record<string, string>[] = [];
  const events: ArazzoRunnerEvent[] = [];
  let time = 0;
  const runner = await ArazzoRunner.load(entryPath, {
    httpClient: httpClient ?? respond(status, headers),
    now: () => (time += 5),
    observer: combineObservers(otel.observer, (event) => events.push(event)),
    requestInterceptor: otel.requestInterceptor,
  });

  let thrown: unknown;
  try {
    await runner.execute(workflowId, { inputs: { status: 'available' } });
  } catch (error) {
    thrown = error;
  }
  return { spans: exporter.getFinishedSpans(), events, headers, thrown };
};

const named = (spans: ReadableSpan[], name: string): ReadableSpan => {
  const span = spans.find((candidate) => candidate.name === name);
  assert.isDefined(span, name);
  return span!;
};

const isChild = (child: ReadableSpan, parent: ReadableSpan): boolean =>
  child.parentSpanContext?.spanId === parent.spanContext().spanId;

describe('openTelemetryTracing', function () {
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
    for (const event of step.events)
      assert.strictEqual(event.attributes?.['arazzo.step.id'], 'findPets');
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

  specify('should end the spans of a run whose transport throws with its error', async function () {
    const { spans, thrown } = await trace('linear', 200, async () => {
      throw new TypeError('fetch failed');
    });

    assert.isDefined(thrown);
    const workflow = named(spans, 'workflow linear');
    const step = named(spans, 'step findPets');
    const request = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    for (const span of [request, step, workflow]) {
      assert.strictEqual(span.status.code, SpanStatusCode.ERROR);
      assert.strictEqual(span.status.message, (thrown as Error).message);
      assert.strictEqual(span.events.at(-1)?.name, 'exception');
    }
  });

  specify('should time spans by the events', async function () {
    const { spans, events } = await trace('linear', 200);

    const started = events.find((event) => event.type === 'workflow:start')!;
    const settled = events.find((event) => event.type === 'workflow:settled')!;
    const workflow = named(spans, 'workflow linear');
    assert.strictEqual(
      hrTimeToMilliseconds(workflow.endTime) - hrTimeToMilliseconds(workflow.startTime),
      settled.timestamp - started.timestamp,
    );
  });

  specify("should propagate the request span's context into the request", async function () {
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    const { spans, headers } = await trace('linear', 200);

    const request = spans.find((span) => span.kind === SpanKind.CLIENT)!;
    const { traceId, spanId } = request.spanContext();
    assert.strictEqual(headers[0].traceparent, `00-${traceId}-${spanId}-01`);
  });
});
