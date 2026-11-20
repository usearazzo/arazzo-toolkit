import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import { ArazzoRunner, Redactor, type HTTPClient } from '../../../src/index.ts';
import { loggingObserver, type LogRecord } from '../../../src/observability/logging/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', '..', 'fixtures', 'workflow-control-flow.arazzo.yaml');

const respond =
  (status: number): HTTPClient =>
  async () =>
    new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

const run = async (
  workflowId: string,
  status: number,
  options: Parameters<typeof loggingObserver>[1] = {},
  httpClient: HTTPClient = respond(status),
): Promise<LogRecord[]> => {
  const records: LogRecord[] = [];
  const runner = await ArazzoRunner.load(entryPath, {
    httpClient,
    requestInterceptor: (request) => {
      request.headers.Authorization = 'Bearer secret';
    },
    observer: loggingObserver((record) => records.push(record), options),
  });
  await runner.execute(workflowId, { inputs: { status: 'available' } }).catch(() => undefined);
  return records;
};

const byType = (records: LogRecord[], type: string): LogRecord[] =>
  records.filter((record) => record.fields.type === type);

describe('loggingObserver', function () {
  specify('should log workflow and step boundaries at info, the rest at debug', async function () {
    const records = await run('linear', 200);

    for (const type of ['workflow:start', 'step:start', 'step:settled', 'workflow:settled']) {
      assert.isNotEmpty(byType(records, type), type);
      for (const record of byType(records, type)) assert.strictEqual(record.level, 'info', type);
    }
    for (const type of ['step:attempt', 'criterion:evaluated', 'openapi:operation:request:start']) {
      for (const record of byType(records, type)) assert.strictEqual(record.level, 'debug', type);
    }
  });

  specify('should log a failed step at warn and a failed workflow at error', async function () {
    const records = await run('linear', 500);

    const [step] = byType(records, 'step:settled');
    assert.strictEqual(step.level, 'warn');
    assert.match(step.message, /^step \S+ failed after 1 attempt$/);
    const [workflow] = byType(records, 'workflow:settled');
    assert.strictEqual(workflow.level, 'error');
    assert.strictEqual(workflow.message, 'workflow linear failed');
  });

  specify('should log a step and workflow that threw at error, with the error', async function () {
    const records = await run('linear', 200, {}, async () => {
      throw new TypeError('fetch failed');
    });

    const [step] = byType(records, 'step:settled');
    const [workflow] = byType(records, 'workflow:settled');
    for (const record of [step, workflow]) {
      assert.strictEqual(record.level, 'error');
      assert.match(record.message, /: OpenAPI operation request failed/);
      assert.instanceOf(record.fields.error, Error);
    }
  });

  specify('should leave the failure of a transfer target to the target', async function () {
    const records = await run('transfersToTarget', 500);

    const settled = byType(records, 'workflow:settled');
    const source = settled.find((record) => record.fields.workflowId === 'transfersToTarget');
    const target = settled.find((record) => record.fields.workflowId === 'transferTarget');
    assert.deepEqual(
      [source?.level, source?.message],
      ['info', 'workflow transfersToTarget transferred'],
    );
    assert.deepEqual([target?.level, target?.message], ['error', 'workflow transferTarget failed']);
  });

  specify('should mask credentials in messages and fields', async function () {
    const records = await run('linear', 200);

    const [request] = byType(records, 'openapi:operation:request:start');
    const { headers } = request.fields.request as { headers: Record<string, string> };
    assert.strictEqual(headers.Authorization, 'REDACTED');
    assert.notInclude(JSON.stringify(records), 'Bearer secret');
  });

  specify('should give a selected action by name and type, not as an element', async function () {
    const records = await run('inheritsFailureActions', 500);

    const [action] = byType(records, 'action:selected');
    assert.deepEqual(action.fields.action, { name: 'stopOnFailure', type: 'end' });
    assert.strictEqual(action.message, 'step only selected action stopOnFailure (end)');
  });

  specify('should take a level per event type and a redactor of its own', async function () {
    const records = await run('linear', 200, {
      levels: { 'criterion:evaluated': 'info' },
      redactor: new Redactor({ fields: [] }),
    });

    for (const record of byType(records, 'criterion:evaluated')) {
      assert.strictEqual(record.level, 'info');
    }
    const [request] = byType(records, 'openapi:operation:request:start');
    const { headers } = request.fields.request as { headers: Record<string, string> };
    assert.strictEqual(headers.Authorization, 'Bearer secret');
  });
});
