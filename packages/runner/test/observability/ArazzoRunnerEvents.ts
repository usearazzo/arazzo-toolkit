import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  DocumentRegistry,
  OpenAPIDocument,
  OpenAPIOperationExecutor,
  type ArazzoRunnerEvent,
  type DocumentRegistryEvent,
  type HTTPClient,
  type OpenAPIOperationEvent,
  type RequestContext,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'workflow-control-flow.arazzo.yaml');
const openAPIPath = path.join(fixturesPath, 'petstore.openapi.json');

const httpClient: HTTPClient = async () =>
  new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('ArazzoRunner events', function () {
  specify('should report every building block to one observer', async function () {
    const events: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      observer: (event) => events.push(event),
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    const types = events.map((event) => event.type);
    // the entry document loads before the run starts.
    assert.deepEqual(types.slice(0, 2), ['document:load:start', 'document:load:settled']);
    assert.include(types, 'workflow:start');
    // the operation pipeline falls between an attempt and its criteria.
    const attempt = types.indexOf('step:attempt');
    assert.deepEqual(
      types
        .slice(attempt + 1)
        .filter((type) => type.startsWith('openapi:operation:'))
        .slice(0, 3),
      [
        'openapi:operation:normalize:start',
        'openapi:operation:normalize:settled',
        'openapi:operation:assembled',
      ],
    );
  });

  specify('should deliver events in the order of their timestamps', async function () {
    const events: ArazzoRunnerEvent[] = [];
    let time = 0;
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      now: () => (time += 1),
      observer: (event) => events.push(event),
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    const timestamps = events.map((event) => event.timestamp);
    assert.deepEqual(
      timestamps,
      [...timestamps].sort((a, b) => a - b),
    );
  });

  specify("should stamp operation events with the run's runId and step", async function () {
    const events: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      observer: (event) => events.push(event),
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    const start = events.find((event) => event.type === 'workflow:start');
    const operations = events.filter((event): event is OpenAPIOperationEvent =>
      event.type.startsWith('openapi:operation:'),
    );
    assert.isNotEmpty(operations);
    assert.isTrue(operations.every((event) => event.runId === start?.runId));
    assert.deepEqual(operations[0].step, { workflowId: 'linear', stepId: 'findPets' });
  });

  specify("should not share an interceptor's request context with events", async function () {
    const contexts: RequestContext[] = [];
    const events: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      requestInterceptor: (request, context) => {
        contexts.push(context);
        return request;
      },
      observer: (event) => events.push(event),
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    const normalized = events.find(
      (event): event is OpenAPIOperationEvent => event.type === 'openapi:operation:normalize:start',
    );
    assert.isTrue(Object.isFrozen(normalized?.operation));
    assert.notStrictEqual(normalized?.operation, contexts[0].operation);
    assert.isFalse(Object.isFrozen(contexts[0].operation));
  });

  specify('should not report documents the registry already holds', async function () {
    const events: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      observer: (event) => events.push(event),
    });
    await runner.execute('linear', { inputs: { status: 'available' } });
    events.length = 0;

    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.isFalse(events.some((event) => event.type.startsWith('document:')));
  });

  context('building blocks on their own', function () {
    specify('should report document loads from a DocumentRegistry', async function () {
      const events: DocumentRegistryEvent[] = [];
      const registry = new DocumentRegistry({
        observer: (event) => events.push(event),
        now: () => 42,
      });

      await registry.acquire(openAPIPath);
      await registry.acquire(openAPIPath);

      assert.deepEqual(
        events.map((event) => [event.type, event.timestamp]),
        [
          ['document:load:start', 42],
          ['document:load:settled', 42],
        ],
      );
      assert.isTrue(events.every((event) => event.uri === events[0].uri));
    });

    specify("should reject with the observer's own error and not cache", async function () {
      const thrown = new Error('observer bug');
      const events: DocumentRegistryEvent[] = [];
      let failNext = true;
      const registry = new DocumentRegistry({
        observer: (event) => {
          events.push(event);
          if (event.type === 'document:load:settled' && failNext) {
            failNext = false;
            throw thrown;
          }
        },
      });

      let caught: unknown;
      try {
        await registry.acquire(openAPIPath);
      } catch (error) {
        caught = error;
      }
      await registry.acquire(openAPIPath);

      assert.strictEqual(caught, thrown);
      // the aborted load left nothing cached, so the second acquire loaded it again.
      assert.deepEqual(
        events.map((event) => event.type),
        [
          'document:load:start',
          'document:load:settled',
          'document:load:start',
          'document:load:settled',
        ],
      );
    });

    specify('should report an OpenAPIOperationExecutor without run or step', async function () {
      const registry = new DocumentRegistry();
      const document = await registry.acquire(openAPIPath);
      assert.isTrue(OpenAPIDocument.is(document));
      const events: OpenAPIOperationEvent[] = [];
      const executor = new OpenAPIOperationExecutor({
        httpClient,
        observer: (event) => events.push(event),
      });

      await executor.execute({
        document: document as OpenAPIDocument,
        jsonPointer: '/paths/~1store~1inventory/get',
      });

      assert.deepEqual(
        events.map((event) => event.type),
        [
          'openapi:operation:normalize:start',
          'openapi:operation:normalize:settled',
          'openapi:operation:assembled',
          'openapi:operation:request:start',
          'openapi:operation:request:settled',
        ],
      );
      assert.isTrue(events.every((event) => !('runId' in event) && !('step' in event)));
    });
  });
});
