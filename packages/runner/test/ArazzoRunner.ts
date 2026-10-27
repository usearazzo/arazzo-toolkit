import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  ArazzoDocument,
  DocumentRegistry,
  ExecutionError,
  InvalidEntryDocumentError,
  type HTTPClient,
  type OpenAPIOperationRequest,
} from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, 'fixtures');
const entryPath = path.join(fixturesPath, 'workflow-control-flow.arazzo.yaml');
const compositionPath = path.join(fixturesPath, 'workflow-composition.arazzo.yaml');

/**
 * A stub transport answering every request with the same pet (or, with
 * `status`, the same error), recording the sent requests into `calls`.
 */
const makeHTTPClient = (calls: OpenAPIOperationRequest[], status = 200): HTTPClient => {
  return async (request) => {
    calls.push(request);
    return new Response(JSON.stringify(status === 200 ? { id: 7, name: 'Rex' } : {}), {
      status,
      statusText: status === 200 ? 'OK' : 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
    });
  };
};

/**
 * Runs a promise expected to reject and returns what it rejected with.
 */
const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

/**
 * Runs a callback expected to throw and returns what it threw.
 */
const captureThrow = (callback: () => unknown): unknown => {
  try {
    callback();
  } catch (error) {
    return error;
  }
  return assert.fail('expected callback to throw, but it returned');
};

describe('ArazzoRunner', function () {
  context('load', function () {
    specify('should load the entry document into a fresh registry', async function () {
      const runner = await ArazzoRunner.load(entryPath);

      assert.isTrue(ArazzoDocument.is(runner.document));
      assert.isTrue(runner.document.isEntry);
      assert.instanceOf(runner.registry, DocumentRegistry);
      assert.strictEqual(runner.registry.entryDocument, runner.document);
    });

    specify('should give every runner its own registry', async function () {
      const first = await ArazzoRunner.load(entryPath);
      const second = await ArazzoRunner.load(compositionPath);

      assert.notStrictEqual(first.registry, second.registry);
      assert.strictEqual(first.registry.entryDocument, first.document);
      assert.strictEqual(second.registry.entryDocument, second.document);
    });

    specify('should load into the given registry', async function () {
      const registry = new DocumentRegistry();

      const runner = await ArazzoRunner.load(entryPath, { registry });

      assert.strictEqual(runner.registry, registry);
      assert.strictEqual(registry.entryDocument, runner.document);
    });

    specify('should reload the same document into the given registry', async function () {
      const registry = new DocumentRegistry();
      const first = await ArazzoRunner.load(entryPath, { registry });

      const second = await ArazzoRunner.load(entryPath, { registry });

      assert.strictEqual(second.document, first.document);
    });

    specify('should reject a second entry document in the given registry', async function () {
      const registry = new DocumentRegistry();
      await ArazzoRunner.load(entryPath, { registry });

      const error = await captureRejection(ArazzoRunner.load(compositionPath, { registry }));

      assert.instanceOf(error, InvalidEntryDocumentError);
    });

    specify('should keep the given registry usable after a rejected load', async function () {
      const registry = new DocumentRegistry();
      const first = await ArazzoRunner.load(entryPath, { registry });
      await captureRejection(ArazzoRunner.load(compositionPath, { registry }));

      // the rejected document is cached but not pinned as a second entry.
      const rejected = registry.get(compositionPath);
      assert.isDefined(rejected);
      assert.isFalse(ArazzoDocument.is(rejected!) && rejected.isEntry);
      const second = await ArazzoRunner.load(entryPath, { registry });
      assert.strictEqual(second.document, first.document);
      assert.strictEqual(registry.entryDocument, first.document);
    });

    specify('should reject a document that is not an Arazzo document', async function () {
      const error = await captureRejection(
        ArazzoRunner.load(path.join(fixturesPath, 'petstore.openapi.json')),
      );

      assert.instanceOf(error, InvalidEntryDocumentError);
    });
  });

  context('constructor', function () {
    specify('should bind to a document acquired by the caller', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const registry = new DocumentRegistry();
      const document = await registry.acquireEntryDocument(entryPath);
      const runner = new ArazzoRunner({ document, registry, httpClient: makeHTTPClient(calls) });

      const result = await runner.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(runner.document, document);
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls.length, 2);
    });

    specify('should reject a document from another registry', async function () {
      const { document } = await ArazzoRunner.load(entryPath);

      const error = captureThrow(
        () => new ArazzoRunner({ document, registry: new DocumentRegistry() }),
      );

      assert.instanceOf(error, InvalidEntryDocumentError);
      assert.strictEqual((error as InvalidEntryDocumentError).uri, document.uri);
    });

    specify('should reject a document that is not the registry entry', async function () {
      // one registry pins both entry documents but reports only the first.
      const registry = new DocumentRegistry();
      await registry.acquireEntryDocument(entryPath);
      const document = await registry.acquireEntryDocument(compositionPath);

      const error = captureThrow(() => new ArazzoRunner({ document, registry }));

      assert.instanceOf(error, InvalidEntryDocumentError);
    });
  });

  context('execute', function () {
    specify('should run a workflow through the given transport', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const runner = await ArazzoRunner.load(entryPath, { httpClient: makeHTTPClient(calls) });

      const result = await runner.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(result.status, 'completed');
      assert.deepEqual(
        result.steps.map((step) => step.stepId),
        ['findPets', 'getPet'],
      );
      assert.strictEqual(calls.length, 2);
      assert.include(calls[1].url, '/pet/7');
      assert.deepEqual(result.outputs, { name: 'Rex', id: 7 });
    });

    specify('should run the requestInterceptor on every request', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const runner = await ArazzoRunner.load(entryPath, {
        httpClient: makeHTTPClient(calls),
        requestInterceptor: (request) => {
          request.headers['x-trace'] = 'abc';
        },
      });

      await runner.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(calls.length, 2);
      assert.isTrue(calls.every((request) => request.headers['x-trace'] === 'abc'));
    });

    specify('should send step parameters the operation does not declare', async function () {
      // a token from one step travels to the next in an Authorization header,
      // a cookie and a path parameter its operation does not declare.
      const calls: OpenAPIOperationRequest[] = [];
      const runner = await ArazzoRunner.load(
        path.join(fixturesPath, 'undeclared-parameters.arazzo.yaml'),
        { httpClient: makeHTTPClient(calls) },
      );

      const result = await runner.execute('tokenThenCall');

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls[1].url, 'https://petstore3.swagger.io/api/v3/pet/7');
      assert.strictEqual(calls[1].headers.Authorization, 'Rex');
      assert.strictEqual(calls[1].headers.Cookie, 'tracking=a%20b%3Bc');
      // a workflow-level parameter reaches every step, declared there or not
      assert.isTrue(calls.every((request) => request.headers['X-Client'] === 'arazzo-runner'));
    });
  });

  context('workflow executor options', function () {
    specify('should forward now', async function () {
      let time = 0;
      const runner = await ArazzoRunner.load(entryPath, {
        httpClient: async (request) => {
          time += 100;
          return makeHTTPClient([])(request);
        },
        now: () => time,
      });

      const result = await runner.execute('linear', { inputs: { status: 'available' } });

      assert.strictEqual(result.durationMs, 200);
    });

    specify('should forward sleep', async function () {
      const sleeps: number[] = [];
      const runner = await ArazzoRunner.load(compositionPath, {
        httpClient: makeHTTPClient([], 500),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });

      await runner.execute('retriesChild');

      assert.deepEqual(sleeps, [1000, 1000]);
    });

    specify('should forward maxSteps', async function () {
      const runner = await ArazzoRunner.load(compositionPath, {
        httpClient: makeHTTPClient([]),
        maxSteps: 2,
      });

      const error = await captureRejection(runner.execute('deepOne'));

      assert.instanceOf(error, ExecutionError);
      assert.strictEqual((error as ExecutionError).reason, 'step-budget');
    });

    specify('should forward maxWorkflowDepth', async function () {
      const runner = await ArazzoRunner.load(compositionPath, {
        httpClient: makeHTTPClient([]),
        maxWorkflowDepth: 2,
      });

      const error = await captureRejection(runner.execute('deepOne'));

      assert.instanceOf(error, ExecutionError);
      assert.strictEqual((error as ExecutionError).reason, 'workflow-depth');
    });
  });
});
