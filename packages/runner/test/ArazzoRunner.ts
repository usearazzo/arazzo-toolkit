import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  ArazzoDocument,
  DocumentRegistry,
  InvalidEntryDocumentError,
  type HTTPClient,
  type OpenAPIOperationRequest,
} from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, 'fixtures');
const entryPath = path.join(fixturesPath, 'workflow-control-flow.arazzo.yaml');

/**
 * A stub transport answering every request with the same pet, recording the
 * sent requests into `calls`.
 */
const makeHTTPClient = (calls: OpenAPIOperationRequest[]): HTTPClient => {
  return async (request) => {
    calls.push(request);
    return new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
  };
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

    specify('should load into the given registry', async function () {
      const registry = new DocumentRegistry();

      const runner = await ArazzoRunner.load(entryPath, { registry });

      assert.strictEqual(runner.registry, registry);
      assert.strictEqual(registry.entryDocument, runner.document);
    });

    specify('should reject a document that is not an Arazzo document', async function () {
      let caught: unknown;
      try {
        await ArazzoRunner.load(path.join(fixturesPath, 'petstore.openapi.json'));
      } catch (error) {
        caught = error;
      }

      assert.instanceOf(caught, InvalidEntryDocumentError);
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

    specify('should forward the workflow executor options', async function () {
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
  });
});
