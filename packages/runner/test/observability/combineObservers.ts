import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  combineObservers,
  type ArazzoRunnerEvent,
  type HTTPClient,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const httpClient: HTTPClient = async () =>
  new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('combineObservers', function () {
  specify('should hand every event to each observer, in order', async function () {
    const calls: string[] = [];
    const first: ArazzoRunnerEvent[] = [];
    const second: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      observer: combineObservers(
        (event) => {
          first.push(event);
          calls.push(`first:${event.type}`);
        },
        (event) => {
          second.push(event);
          calls.push(`second:${event.type}`);
        },
      ),
    });

    await runner.execute('linear', { inputs: { status: 'available' } });

    assert.isAbove(first.length, 0);
    assert.deepEqual(second, first);
    assert.deepEqual(calls.slice(0, 2), [`first:${first[0].type}`, `second:${first[0].type}`]);
  });

  specify('should abort the run with the error of an observer that throws', async function () {
    const later: string[] = [];
    const runner = await ArazzoRunner.load(entryPath, {
      httpClient,
      observer: combineObservers(
        (event) => {
          if (event.type === 'step:start') throw new Error('observer failed');
        },
        (event) => later.push(event.type),
      ),
    });

    let caught: unknown;
    try {
      await runner.execute('linear', { inputs: { status: 'available' } });
    } catch (error) {
      caught = error;
    }

    assert.instanceOf(caught, Error);
    assert.strictEqual((caught as Error).message, 'observer failed');
    assert.notInclude(later, 'step:start');
  });

  specify('should accept no observers', function () {
    assert.doesNotThrow(() =>
      combineObservers()({ type: 'document:load:start', timestamp: 0, uri: 'x' }),
    );
  });
});
