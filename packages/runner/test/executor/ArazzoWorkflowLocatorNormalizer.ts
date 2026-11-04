import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  ArazzoDocument,
  ArazzoWorkflowLocatorNormalizer,
  ExecutionError,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'cross-document.arazzo.yaml');

const captureError = async (promise: Promise<unknown>): Promise<ExecutionError> => {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.instanceOf(caught, ExecutionError);
  return caught as ExecutionError;
};

describe('ArazzoWorkflowLocatorNormalizer', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;
  let normalizer: ArazzoWorkflowLocatorNormalizer;

  beforeEach(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
    normalizer = new ArazzoWorkflowLocatorNormalizer(registry);
  });

  specify('should resolve a plain workflowId to the referencing document', async function () {
    const locator = await normalizer.normalize('crossDocumentStep', entry, {
      workflowId: 'caller',
    });

    assert.strictEqual(locator.document, entry);
    assert.strictEqual(locator.workflowId, 'crossDocumentStep');
  });

  specify(
    'should resolve a $sourceDescriptions reference to the foreign document',
    async function () {
      const locator = await normalizer.normalize(
        '$sourceDescriptions.childWorkflows.childFetch',
        entry,
        { workflowId: 'caller' },
      );

      assert.match(locator.document.uri, /cross-document-child\.arazzo\.yaml$/);
      assert.strictEqual(locator.workflowId, 'childFetch');
    },
  );

  specify(
    'should reject a plain workflowId the document does not define, attributed to the referencing context',
    async function () {
      const error = await captureError(
        normalizer.normalize('noSuchWorkflow', entry, { workflowId: 'caller', stepId: 'call' }),
      );

      assert.strictEqual(error.reason, 'workflow-not-found');
      assert.strictEqual(error.workflowId, 'caller');
      assert.strictEqual(error.stepId, 'call');
      assert.match(error.message, /noSuchWorkflow/);
    },
  );

  specify(
    'should reject a $sourceDescriptions reference to a workflow the foreign document does not define',
    async function () {
      const error = await captureError(
        normalizer.normalize('$sourceDescriptions.childWorkflows.noSuchWorkflow', entry, {
          workflowId: 'caller',
        }),
      );

      assert.strictEqual(error.reason, 'workflow-not-found');
      assert.strictEqual(error.workflowId, 'caller');
      assert.isUndefined(error.stepId);
      // the message names the document searched — the child, not the entry.
      assert.match(error.message, /cross-document-child\.arazzo\.yaml/);
    },
  );
});
