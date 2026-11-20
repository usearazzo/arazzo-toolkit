import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  instrument,
  type ArazzoRunnerEvent,
  type HTTPClient,
  type InstrumentedOperation,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const respond =
  (status: number): HTTPClient =>
  async () =>
    new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

const nameOf = (operation: InstrumentedOperation): string =>
  operation.kind === 'workflow' ? `workflow ${operation.workflowId}` : `step ${operation.stepId}`;

describe('instrument', function () {
  const removals: (() => void)[] = [];
  const hook = (hooks: Parameters<typeof instrument>[0]): void => {
    removals.push(instrument(hooks));
  };

  afterEach(function () {
    for (const remove of removals.splice(0)) remove();
  });

  specify('should report every event of a runner given no observer', async function () {
    const events: ArazzoRunnerEvent[] = [];
    hook({ observer: (event) => events.push(event) });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    await runner.execute('linear', { inputs: { status: 'available' } });

    const types = events.map((event) => event.type);
    assert.strictEqual(types[0], 'document:load:start');
    assert.include(types, 'openapi:operation:request:settled');
    assert.strictEqual(types.at(-1), 'workflow:settled');
  });

  specify('should report nothing once the hooks are removed', async function () {
    const events: ArazzoRunnerEvent[] = [];
    const remove = instrument({ observer: (event) => events.push(event) });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });
    remove();
    events.length = 0;

    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.isEmpty(events);
  });

  specify('should run each workflow and step, and its events, inside its wrap', async function () {
    const open: string[] = [];
    const seen: string[] = [];
    const requests: string[] = [];
    hook({
      wrap: async (operation, run) => {
        open.push(nameOf(operation));
        try {
          await run();
        } finally {
          open.pop();
        }
      },
      observer: (event) => {
        if (event.type === 'workflow:start' || event.type.startsWith('step:')) {
          seen.push(`${event.type} in ${open.at(-1)}`);
        }
      },
    });
    const httpClient = respond(200);
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient: (request) => {
        requests.push(open.join(' > '));
        return httpClient(request);
      },
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(seen[0], 'workflow:start in workflow linear');
    assert.includeMembers(seen, [
      'step:start in step findPets',
      'step:attempt in step findPets',
      'step:settled in step findPets',
    ]);
    // the HTTP client runs inside the step's wrap, inside the workflow's
    assert.strictEqual(requests[0], 'workflow linear > step findPets');
  });

  specify(
    'should apply wraps in the order they were added, the first outermost',
    async function () {
      const order: string[] = [];
      for (const name of ['first', 'second']) {
        hook({
          wrap: async (operation, run) => {
            if (operation.kind === 'workflow') order.push(`${name} in`);
            await run();
            if (operation.kind === 'workflow') order.push(`${name} out`);
          },
        });
      }
      const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

      await runner.execute('linear', { inputs: { status: 'available' } });

      assert.deepEqual(order, ['first in', 'second in', 'second out', 'first out']);
    },
  );

  specify('should keep the result of a run whose wrap throws after it', async function () {
    hook({
      wrap: async (_operation, run) => {
        await run();
        throw new Error('instrumentation bug');
      },
    });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    const result = await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(result.status, 'completed');
  });

  specify('should reject a run whose wrap swallows its error', async function () {
    hook({
      wrap: async (_operation, run) => {
        await run().catch(() => undefined);
      },
    });
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient: async () => {
        throw new TypeError('fetch failed');
      },
    });

    let caught: unknown;
    try {
      await runner.execute('linear', { inputs: { status: 'available' } });
    } catch (error) {
      caught = error;
    }

    assert.match((caught as Error).message, /OpenAPI operation request failed/);
  });

  specify('should reject a wrap that settles without running', async function () {
    hook({ wrap: async () => {} });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    let caught: unknown;
    try {
      await runner.execute('linear', { inputs: { status: 'available' } });
    } catch (error) {
      caught = error;
    }

    assert.instanceOf(caught, TypeError);
    assert.match((caught as Error).message, /without running the workflow/);
  });

  specify('should run once a wrap that calls run twice', async function () {
    let requests = 0;
    const httpClient = respond(200);
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient: (request) => {
        requests += 1;
        return httpClient(request);
      },
    });

    await runner.execute('linear', { inputs: { status: 'available' } });
    const unwrapped = requests;
    hook({
      wrap: async (_operation, run) => {
        await run();
        await run();
      },
    });
    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(requests, 2 * unwrapped);
  });

  specify('should wait for the work of a wrap that does not await it', async function () {
    hook({
      wrap: async (_operation, run) => {
        void run();
      },
    });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    const result = await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(result.status, 'completed');
  });

  specify('should still notify the next observer when one removes its hook', async function () {
    const seen: string[] = [];
    const remove = instrument({
      observer: () => {
        remove();
      },
    });
    hook({ observer: (event) => seen.push(event.type) });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.strictEqual(seen[0], 'document:load:start');
  });

  specify('should pick up hooks added during a run', async function () {
    const seen: string[] = [];
    const wrapped: string[] = [];
    let added = false;
    const httpClient = respond(200);
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient: (request) => {
        if (!added) {
          added = true;
          hook({
            observer: (event) => seen.push(event.type),
            wrap: async (operation, run) => {
              wrapped.push(nameOf(operation));
              await run();
            },
          });
        }
        return httpClient(request);
      },
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    // added during the first step: its settled event is seen, and the next step wrapped
    assert.include(seen, 'step:settled');
    assert.deepEqual(wrapped, ['step getPet']);
  });

  specify('should settle a workflow whose start an observer throws on', async function () {
    const thrown = new Error('observer bug');
    const settled: ArazzoRunnerEvent[] = [];
    hook({
      observer: (event) => {
        if (event.type === 'workflow:start') throw thrown;
      },
    });
    hook({
      observer: (event) => {
        if (event.type === 'workflow:settled') settled.push(event);
      },
    });
    const runner = await ArazzoRunner.load(entryPath, { httpClient: respond(200) });

    let caught: unknown;
    try {
      await runner.execute('linear', { inputs: { status: 'available' } });
    } catch (error) {
      caught = error;
    }

    assert.strictEqual(caught, thrown);
    assert.lengthOf(settled, 1);
    assert.strictEqual(settled[0].type === 'workflow:settled' && settled[0].error, thrown);
  });

  specify(
    'should reject with the run error when an observer throws settling it',
    async function () {
      hook({
        observer: (event) => {
          if (event.type === 'step:settled' || event.type === 'workflow:settled') {
            if ('error' in event) throw new Error('observer bug');
          }
        },
      });
      const runner = await ArazzoRunner.load(entryPath, {
        httpClient: async () => {
          throw new TypeError('fetch failed');
        },
      });

      let caught: unknown;
      try {
        await runner.execute('linear', { inputs: { status: 'available' } });
      } catch (error) {
        caught = error;
      }

      assert.match((caught as Error).message, /OpenAPI operation request failed/);
    },
  );
});
