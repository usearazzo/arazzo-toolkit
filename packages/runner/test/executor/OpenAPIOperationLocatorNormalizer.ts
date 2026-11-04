import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  ArazzoDocument,
  ExecutionError,
  OpenAPIOperationLocatorNormalizer,
} from '../../src/index.ts';
import type { ExecutionErrorReason } from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const entryPath = path.join(fixturesPath, 'petstore-order-workflow.arazzo.yaml');
const childPath = path.join(fixturesPath, 'cross-document-child.arazzo.yaml');
const arazzoSourcesOnlyPath = path.join(fixturesPath, 'arazzo-sources-only.arazzo.yaml');

const referenceContext = { workflowId: 'caller', stepId: 'call' };

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

/**
 * Asserts an error carries the reason and the referencing context it was
 * normalized in.
 */
const assertRejection = (error: ExecutionError, reason: ExecutionErrorReason): void => {
  assert.strictEqual(error.reason, reason);
  assert.strictEqual(error.workflowId, 'caller');
  assert.strictEqual(error.stepId, 'call');
};

describe('OpenAPIOperationLocatorNormalizer', function () {
  let registry: DocumentRegistry;
  let entry: ArazzoDocument;
  let normalizer: OpenAPIOperationLocatorNormalizer;

  beforeEach(async function () {
    registry = new DocumentRegistry();
    entry = await registry.acquireEntryDocument(entryPath);
    normalizer = new OpenAPIOperationLocatorNormalizer(registry);
  });

  const expectedSourceURI = () => entry.resolveSourceDescriptionURI('petstoreAPI')!;

  context('normalizeOperationId', function () {
    specify('should resolve a plain operationId to (document, jsonPointer)', async function () {
      const locator = await normalizer.normalizeOperationId('findPetsByStatus', entry);

      assert.strictEqual(locator.document.uri, expectedSourceURI());
      assert.strictEqual(locator.jsonPointer, '/paths/~1pet~1findByStatus/get');
    });

    specify('should resolve a $sourceDescriptions operationId expression', async function () {
      const locator = await normalizer.normalizeOperationId(
        '$sourceDescriptions.petstoreAPI.findPetsByStatus',
        entry,
      );

      assert.strictEqual(locator.document.uri, expectedSourceURI());
      assert.strictEqual(locator.jsonPointer, '/paths/~1pet~1findByStatus/get');
    });

    specify('should reject a plain operationId its OpenAPI source lacks', async function () {
      const error = await captureError(
        normalizer.normalizeOperationId('noSuchOperation', entry, referenceContext),
      );

      assertRejection(error, 'operation-not-found');
      assert.match(error.message, /noSuchOperation/);
    });

    specify('should reject a $sourceDescriptions operationId its source lacks', async function () {
      const error = await captureError(
        normalizer.normalizeOperationId(
          '$sourceDescriptions.petstoreAPI.noSuchOperation',
          entry,
          referenceContext,
        ),
      );

      assertRejection(error, 'operation-not-found');
      assert.match(error.message, /noSuchOperation.*petstoreAPI/);
    });

    specify(
      'should reject a plain operationId when no source is an OpenAPI document',
      async function () {
        // nothing was named, so this is a missing operation, not a missing source.
        const ownRegistry = new DocumentRegistry();
        const arazzoOnly = await ownRegistry.acquireEntryDocument(arazzoSourcesOnlyPath);

        const error = await captureError(
          new OpenAPIOperationLocatorNormalizer(ownRegistry).normalizeOperationId(
            'getInventory',
            arazzoOnly,
            referenceContext,
          ),
        );

        assertRejection(error, 'operation-not-found');
        assert.match(error.message, /no OpenAPI source description/);
      },
    );

    specify('should reject a source name the document does not define', async function () {
      const error = await captureError(
        normalizer.normalizeOperationId(
          '$sourceDescriptions.nope.getInventory',
          entry,
          referenceContext,
        ),
      );

      assertRejection(error, 'source-description-not-found');
      assert.match(error.message, /"nope"/);
    });

    specify('should reject a named source that is not an OpenAPI document', async function () {
      const child = await registry.acquire(childPath);
      assert.isTrue(ArazzoDocument.is(child));

      const error = await captureError(
        normalizer.normalizeOperationId(
          '$sourceDescriptions.parent.getInventory',
          child as ArazzoDocument,
          referenceContext,
        ),
      );

      assertRejection(error, 'source-description-not-openapi');
    });

    specify('should reject an expression that is not a $sourceDescriptions one', async function () {
      const error = await captureError(
        normalizer.normalizeOperationId('$inputs.operation', entry, referenceContext),
      );

      assertRejection(error, 'invalid-operation-reference');
    });

    specify('should carry no context when none is given', async function () {
      const error = await captureError(normalizer.normalizeOperationId('noSuchOperation', entry));

      assert.strictEqual(error.reason, 'operation-not-found');
      assert.isUndefined(error.workflowId);
      assert.isUndefined(error.stepId);
    });
  });

  context('normalizeOperationPath', function () {
    specify(
      'should interpolate the embedded source url and resolve (document, jsonPointer)',
      async function () {
        const locator = await normalizer.normalizeOperationPath(
          '{$sourceDescriptions.petstoreAPI.url}#/paths/~1pet~1findByStatus/get',
          entry,
        );

        // the embedded {$sourceDescriptions.petstoreAPI.url} — a relative url in
        // the fixture — resolves to the absolute source document URI.
        assert.strictEqual(locator.document.uri, expectedSourceURI());
        assert.match(locator.document.uri, /\/fixtures\/petstore\.openapi\.json$/);
        assert.strictEqual(locator.jsonPointer, '/paths/~1pet~1findByStatus/get');
      },
    );

    specify('should resolve a literal (non-expression) source url', async function () {
      // the runner does not require a runtime expression for the source (that is
      // a validator concern): a literal url interpolates to itself and resolves.
      const literalOperationPath = `${expectedSourceURI()}#/paths/~1pet~1findByStatus/get`;

      const locator = await normalizer.normalizeOperationPath(literalOperationPath, entry);

      assert.strictEqual(locator.document.uri, expectedSourceURI());
      assert.strictEqual(locator.jsonPointer, '/paths/~1pet~1findByStatus/get');
    });

    specify('should decode a percent-encoded JSON Pointer fragment', async function () {
      // ~1 is the JSON Pointer escape for '/'; a percent-encoded fragment must
      // decode to the same pointer.
      const locator = await normalizer.normalizeOperationPath(
        '{$sourceDescriptions.petstoreAPI.url}#/paths/~1pet~1findByStatus/get',
        entry,
      );
      assert.strictEqual(locator.jsonPointer, '/paths/~1pet~1findByStatus/get');
    });

    specify('should acquire the source lazily (no pre-load required)', async function () {
      // a fresh registry with only the entry document loaded — the normalizer
      // must acquire the source on demand.
      const freshRegistry = new DocumentRegistry();
      const freshEntry = await freshRegistry.acquireEntryDocument(entryPath);
      const freshNormalizer = new OpenAPIOperationLocatorNormalizer(freshRegistry);

      const locator = await freshNormalizer.normalizeOperationPath(
        '{$sourceDescriptions.petstoreAPI.url}#/paths/~1pet~1findByStatus/get',
        freshEntry,
      );

      assert.strictEqual(
        locator.document.uri,
        freshEntry.resolveSourceDescriptionURI('petstoreAPI'),
      );
    });

    specify('should carry no scope when none is given', async function () {
      const error = await captureError(
        normalizer.normalizeOperationPath(
          '{$sourceDescriptions.petstoreAPI.url}#/paths/~1nope/get',
          entry,
        ),
      );

      assert.strictEqual(error.reason, 'operation-not-found');
      assert.isUndefined(error.workflowId);
      assert.isUndefined(error.stepId);
    });

    specify('should reject a pointer that locates no operation', async function () {
      const error = await captureError(
        normalizer.normalizeOperationPath(
          '{$sourceDescriptions.petstoreAPI.url}#/paths/~1nope/get',
          entry,
          referenceContext,
        ),
      );

      assertRejection(error, 'operation-not-found');
      assert.match(error.message, /does not locate an operation/);
    });

    specify(
      'should reject a source name the document does not define, before interpolation',
      async function () {
        // interpolating first would turn the unknown name into an empty URL
        // and misreport it as a malformed reference.
        const error = await captureError(
          normalizer.normalizeOperationPath(
            '{$sourceDescriptions.nope.url}#/paths/~1pet~1findByStatus/get',
            entry,
            referenceContext,
          ),
        );

        assertRejection(error, 'source-description-not-found');
        assert.match(error.message, /"nope"/);
      },
    );

    specify('should reject an operationPath with no source URL', async function () {
      const error = await captureError(
        normalizer.normalizeOperationPath(
          '#/paths/~1pet~1findByStatus/get',
          entry,
          referenceContext,
        ),
      );

      assertRejection(error, 'invalid-operation-reference');
    });

    specify('should reject an invalid JSON Pointer', async function () {
      const error = await captureError(
        normalizer.normalizeOperationPath(
          '{$sourceDescriptions.petstoreAPI.url}#paths',
          entry,
          referenceContext,
        ),
      );

      assertRejection(error, 'invalid-operation-reference');
    });

    specify('should reject a source URL that is not an OpenAPI document', async function () {
      const child = await registry.acquire(childPath);

      const error = await captureError(
        normalizer.normalizeOperationPath(
          '{$sourceDescriptions.parent.url}#/paths/~1pet/get',
          child as ArazzoDocument,
          referenceContext,
        ),
      );

      assertRejection(error, 'source-description-not-openapi');
    });
  });
});
