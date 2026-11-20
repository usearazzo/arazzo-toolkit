import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';

import { ArazzoRunner, type HTTPClient } from '../../../src/index.ts';
import { ArazzoRunnerInstrumentation } from '../../../src/observability/opentelemetry/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');
const compositionPath = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'workflow-composition.arazzo.yaml',
);

const named = (spans: ReadableSpan[], name: string): ReadableSpan => {
  const span = spans.find((candidate) => candidate.name === name);
  assert.isDefined(span, name);
  return span!;
};

const isChild = (child: ReadableSpan, parent: ReadableSpan): boolean =>
  child.parentSpanContext?.spanId === parent.spanContext().spanId;

describe('ArazzoRunnerInstrumentation', function () {
  const contextManager = new AsyncLocalStorageContextManager();
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  let instrumentation: ArazzoRunnerInstrumentation;

  before(function () {
    context.setGlobalContextManager(contextManager.enable());
  });

  after(function () {
    context.disable();
  });

  beforeEach(function () {
    instrumentation = new ArazzoRunnerInstrumentation();
    instrumentation.setTracerProvider(provider);
  });

  afterEach(function () {
    instrumentation.disable();
    exporter.reset();
  });

  // runs `workflowId` against a client answering `status`, recording the span
  // active while each request is sent: what HTTP instrumentation parents to
  const run = async (
    workflowId: string,
    status: number,
    httpClient?: HTTPClient,
    document = entryPath,
  ): Promise<{ spans: ReadableSpan[]; active: (Span | undefined)[]; thrown?: unknown }> => {
    const active: (Span | undefined)[] = [];
    const runner = await ArazzoRunner.load(document, {
      httpClient:
        httpClient ??
        (async () => {
          active.push(trace.getActiveSpan());
          return new Response(JSON.stringify({ id: 7 }), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        }),
    });
    let thrown: unknown;
    try {
      await runner.execute(workflowId, { inputs: { status: 'available' } });
    } catch (error) {
      thrown = error;
    }
    return { spans: exporter.getFinishedSpans(), active, thrown };
  };

  specify('should nest steps under workflows, and requests under steps', async function () {
    const { spans, active } = await run('linear', 200);

    const workflow = named(spans, 'workflow linear');
    const step = named(spans, 'step findPets');
    assert.isTrue(isChild(step, workflow));
    assert.strictEqual(active[0]?.spanContext().spanId, step.spanContext().spanId);
    assert.include(step.attributes, {
      'arazzo.workflow.id': 'linear',
      'arazzo.step.id': 'findPets',
      'arazzo.step.attempts': 1,
    });
    assert.deepEqual(
      step.events.map((event) => event.name),
      ['attempt', 'operation', 'criterion', 'action'],
    );
    for (const event of step.events)
      assert.strictEqual(event.attributes?.['arazzo.step.id'], 'findPets');
  });

  specify('should keep the tree of a run when the context is lost', async function () {
    // no context manager, as with one that loses context across a native await
    context.disable();
    try {
      const { spans } = await run('linear', 200);

      const workflow = named(spans, 'workflow linear');
      const step = named(spans, 'step findPets');
      assert.isTrue(isChild(step, workflow));
      assert.include(
        step.events.map((event) => event.name),
        'attempt',
      );
      assert.strictEqual(step.attributes['arazzo.step.attempts'], 1);
    } finally {
      context.setGlobalContextManager(contextManager.enable());
    }
  });

  specify('should nest a sub-workflow under the step that calls it', async function () {
    const { spans } = await run('callsChild', 200, undefined, compositionPath);

    const parent = named(spans, 'workflow callsChild');
    const step = named(spans, 'step child');
    const child = named(spans, 'workflow fetchPet');
    assert.isTrue(isChild(step, parent));
    assert.isTrue(isChild(child, step));
    assert.isTrue(isChild(named(spans, 'step after'), parent));
  });

  specify('should keep concurrent runs apart when the context is lost', async function () {
    context.disable();
    try {
      await Promise.all([run('linear', 200), run('linear', 200)]);

      const spans = exporter.getFinishedSpans();
      const workflows = spans.filter((span) => span.name === 'workflow linear');
      assert.lengthOf(workflows, 2);
      for (const workflow of workflows) {
        const steps = spans.filter((span) => isChild(span, workflow));
        assert.deepEqual(steps.map((span) => span.name).sort(), ['step findPets', 'step getPet']);
        for (const step of steps) {
          assert.strictEqual(
            step.attributes['arazzo.run.id'],
            workflow.attributes['arazzo.run.id'],
          );
        }
      }
    } finally {
      context.setGlobalContextManager(contextManager.enable());
    }
  });

  specify('should nest the run under the span active when it is called', async function () {
    const tracer = provider.getTracer('test');
    await tracer.startActiveSpan('caller', async (caller) => {
      await run('linear', 200);
      caller.end();
    });

    const spans = exporter.getFinishedSpans();
    assert.isTrue(isChild(named(spans, 'workflow linear'), named(spans, 'caller')));
  });

  specify('should mark a failed step and workflow as errors', async function () {
    const { spans } = await run('linear', 500);

    assert.strictEqual(named(spans, 'workflow linear').status.code, SpanStatusCode.ERROR);
    assert.strictEqual(named(spans, 'step findPets').status.code, SpanStatusCode.ERROR);
  });

  specify('should mark only the failed target of a transfer as an error', async function () {
    const { spans } = await run('transfersToTarget', 500);

    assert.strictEqual(
      named(spans, 'workflow transfersToTarget').status.code,
      SpanStatusCode.UNSET,
    );
    assert.strictEqual(named(spans, 'workflow transferTarget').status.code, SpanStatusCode.ERROR);
  });

  specify('should end the spans of a run that throws, recording its error', async function () {
    const { spans, thrown } = await run('linear', 200, async () => {
      throw new TypeError('fetch failed');
    });

    for (const span of [named(spans, 'step findPets'), named(spans, 'workflow linear')]) {
      assert.strictEqual(span.status.code, SpanStatusCode.ERROR);
      assert.strictEqual(span.status.message, (thrown as Error).message);
      assert.strictEqual(span.events.at(-1)?.name, 'exception');
    }
  });

  specify('should trace nothing while disabled', async function () {
    instrumentation.disable();
    await run('linear', 200);
    assert.isEmpty(exporter.getFinishedSpans());

    instrumentation.enable();
    instrumentation.enable();
    const { spans } = await run('linear', 200);
    assert.lengthOf(
      spans.filter((span) => span.name === 'workflow linear'),
      1,
    );
  });

  specify('should start disabled with enabled: false, as instrumentations do', function () {
    instrumentation.disable();
    const disabled = new ArazzoRunnerInstrumentation({ enabled: false });

    assert.deepEqual(disabled.getConfig(), { enabled: false });
    assert.deepEqual(instrumentation.getConfig(), { enabled: true });
    assert.strictEqual(disabled.instrumentationName, '@usearazzo/runner');
    assert.match(disabled.instrumentationVersion, /^\d+\.\d+\.\d+/);
  });
});
