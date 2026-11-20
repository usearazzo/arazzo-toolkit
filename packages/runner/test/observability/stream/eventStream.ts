import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  Redactor,
  type ArazzoRunnerEvent,
  type HTTPClient,
} from '../../../src/index.ts';
import { eventStream, type EventStream } from '../../../src/observability/stream/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const httpClient: HTTPClient = async () =>
  new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const load = (events: EventStream) =>
  ArazzoRunner.load(entryPath, {
    httpClient,
    requestInterceptor: (request) => {
      request.headers.Authorization = 'Bearer secret';
    },
    observer: events.observer,
  });

const collect = async (iterable: AsyncIterable<ArazzoRunnerEvent>) => {
  const collected: ArazzoRunnerEvent[] = [];
  for await (const event of iterable) collected.push(event);
  return collected;
};

describe('eventStream', function () {
  specify('should yield every event of a run, masked, until closed', async function () {
    const events = eventStream();
    const runner = await load(events);

    const reading = collect(events);
    await runner.execute('linear', { inputs: { status: 'available' } }).then(events.close);
    const collected = await reading;

    const types = collected.map((event) => event.type);
    assert.strictEqual(types[0], 'document:load:start');
    assert.strictEqual(types.at(-1), 'workflow:settled');
    assert.include(types, 'openapi:operation:request:start');
    assert.notInclude(JSON.stringify(collected), 'Bearer secret');
  });

  specify('should reject reading with the error passed to error', async function () {
    const events = eventStream();
    const runner = await load(events);

    const reading = collect(events);
    await runner.execute('noSuchWorkflow').then(events.close, events.error);

    let caught: unknown;
    try {
      await reading;
    } catch (error) {
      caught = error;
    }
    assert.match((caught as Error).message, /noSuchWorkflow/);
  });

  specify('should deliver the events queued before error, then reject', async function () {
    const events = eventStream();
    events.observer({ type: 'document:load:start', timestamp: 0, uri: 'a' });
    events.observer({ type: 'document:load:settled', timestamp: 1, uri: 'a' });
    events.error(new Error('run failed'));

    const read: string[] = [];
    let caught: unknown;
    try {
      for await (const event of events) read.push(event.type);
    } catch (error) {
      caught = error;
    }

    assert.deepEqual(read, ['document:load:start', 'document:load:settled']);
    assert.strictEqual((caught as Error).message, 'run failed');
  });

  specify('should stop queuing when the consumer stops early', async function () {
    const events = eventStream();
    const runner = await load(events);

    const reading = (async () => {
      for await (const event of events) return event;
      return undefined;
    })();
    const result = await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(result.status, 'completed');
    assert.strictEqual((await reading)?.type, 'document:load:start');
    assert.doesNotThrow(() => events.close());
  });

  specify('should be readable as a ReadableStream, with a redactor of its own', async function () {
    const events = eventStream({ redactor: new Redactor({ fields: [] }) });
    const runner = await load(events);

    const reading = collect(events.stream);
    await runner.execute('linear', { inputs: { status: 'available' } });
    events.close();
    events.observer({ type: 'document:load:start', timestamp: 0, uri: 'after-close' });

    const collected = await reading;
    assert.include(JSON.stringify(collected), 'Bearer secret');
    assert.notInclude(JSON.stringify(collected), 'after-close');
  });
});
