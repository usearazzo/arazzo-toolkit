import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  DocumentRegistryProvider,
  ArazzoDocumentRegistryProvider,
  OpenAPIDocumentRegistryProvider,
  RuntimeExpressionEvaluator,
  DocumentLoadError,
  UnmatchedProviderError,
  type APIDocument,
  type ArazzoDocument,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  '..',
  'fixtures',
  'source-descriptions-loading.arazzo.yaml',
);

/**
 * The OpenAPI provider, counting how often it loads each document.
 */
class CountingOpenAPIProvider extends DocumentRegistryProvider {
  override readonly sourceDescriptionType = 'openapi';

  readonly #inner = new OpenAPIDocumentRegistryProvider();

  readonly loads = new Map<string, number>();

  async canProvide(uri: string): Promise<boolean> {
    return this.#inner.canProvide(uri);
  }

  async provide(uri: string): Promise<APIDocument> {
    this.loads.set(uri, (this.loads.get(uri) ?? 0) + 1);
    return this.#inner.provide(uri);
  }
}

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

describe('RuntimeExpressionEvaluator $sourceDescriptions loading', function () {
  let registry: DocumentRegistry;
  let openapi: CountingOpenAPIProvider;
  let entryDoc: ArazzoDocument;
  let evaluator: RuntimeExpressionEvaluator;

  beforeEach(async function () {
    openapi = new CountingOpenAPIProvider();
    registry = new DocumentRegistry({
      providers: [new ArazzoDocumentRegistryProvider(), openapi],
    });
    entryDoc = await registry.acquireEntryDocument(fixturePath);
    evaluator = new RuntimeExpressionEvaluator({}, { document: entryDoc, registry, strict: false });
  });

  context('given a source no step has loaded yet', function () {
    specify('should load the document and resolve the operation', async function () {
      const operation = (await evaluator.evaluate(
        '$sourceDescriptions.petstoreAPI.getPetById',
      )) as {
        operationId?: string;
      };

      assert.strictEqual(operation?.operationId, 'getPetById');
    });

    specify('should resolve it inside an interpolated template', async function () {
      const uri = entryDoc.resolveSourceDescriptionURI('petstoreAPI');

      assert.strictEqual(
        await evaluator.interpolate('{$sourceDescriptions.petstoreAPI.url}#/paths/~1pet/put'),
        `${uri}#/paths/~1pet/put`,
      );
    });
  });

  context('given a source evicted from the registry', function () {
    specify('should load the document again and resolve the operation', async function () {
      const petstoreURI = entryDoc.resolveSourceDescriptionURI('petstoreAPI')!;
      await evaluator.evaluate('$sourceDescriptions.petstoreAPI.getPetById');
      // three more documents fill the registry (entry included) and evict petstore
      for (const name of ['petstore31API', 'multipartAPI', 'dualLocationAPI']) {
        await registry.acquire(entryDoc.resolveSourceDescriptionURI(name)!);
      }

      const operation = (await evaluator.evaluate(
        '$sourceDescriptions.petstoreAPI.getPetById',
      )) as {
        operationId?: string;
      };

      assert.strictEqual(openapi.loads.get(petstoreURI), 2);
      assert.strictEqual(operation?.operationId, 'getPetById');
    });
  });

  context('given a source of a type no provider loads', function () {
    specify('should resolve a field without loading the document', async function () {
      assert.strictEqual(
        await evaluator.evaluate('$sourceDescriptions.eventsAPI.url'),
        entryDoc.resolveSourceDescriptionURI('eventsAPI'),
      );
    });

    specify('should resolve any other reference to undefined', async function () {
      // the AsyncAPI file does not exist: an attempt to load it would reject
      assert.isUndefined(await evaluator.evaluate('$sourceDescriptions.eventsAPI.publishEvent'));
    });
  });

  context('given a source whose document cannot be loaded', function () {
    specify('should resolve a field the source description declares', async function () {
      assert.strictEqual(
        await evaluator.evaluate('$sourceDescriptions.missingAPI.url'),
        entryDoc.resolveSourceDescriptionURI('missingAPI'),
      );
    });

    specify('should reject any other reference with the load error', async function () {
      const error = await captureRejection(
        evaluator.evaluate('$sourceDescriptions.missingAPI.getPetById'),
      );

      assert.instanceOf(error, DocumentLoadError);
      assert.strictEqual(
        (error as DocumentLoadError).uri,
        entryDoc.resolveSourceDescriptionURI('missingAPI'),
      );
    });
  });

  context('given a source whose document no provider can read', function () {
    specify('should resolve a field the source description declares', async function () {
      assert.strictEqual(
        await evaluator.evaluate('$sourceDescriptions.unreadableAPI.url'),
        entryDoc.resolveSourceDescriptionURI('unreadableAPI'),
      );
    });

    specify('should reject any other reference with the provider error', async function () {
      const error = await captureRejection(
        evaluator.evaluate('$sourceDescriptions.unreadableAPI.getPetById'),
      );

      assert.instanceOf(error, UnmatchedProviderError);
    });
  });

  context('given a source with no usable type whose document cannot be loaded', function () {
    for (const name of ['untypedMissingAPI', 'numericTypeMissingAPI']) {
      specify(`should try to load ${name} and reject with the load error`, async function () {
        const error = await captureRejection(
          evaluator.evaluate(`$sourceDescriptions.${name}.getPetById`),
        );

        assert.instanceOf(error, DocumentLoadError);
      });
    }
  });

  context('given a workflow step reference into a document that cannot be loaded', function () {
    specify('should reject with the load error', async function () {
      const error = await captureRejection(
        evaluator.evaluate('$sourceDescriptions.missingFlows.someWorkflow.steps.someStep'),
      );

      assert.instanceOf(error, DocumentLoadError);
    });
  });

  context('given strict mode', function () {
    specify('should resolve a field of a source that cannot be loaded', async function () {
      const strict = new RuntimeExpressionEvaluator({}, { document: entryDoc, registry });

      assert.strictEqual(
        await strict.evaluate('$sourceDescriptions.missingAPI.url'),
        entryDoc.resolveSourceDescriptionURI('missingAPI'),
      );
    });

    specify('should reject any other reference with the load error', async function () {
      const strict = new RuntimeExpressionEvaluator({}, { document: entryDoc, registry });

      const error = await captureRejection(
        strict.evaluate('$sourceDescriptions.missingAPI.getPetById'),
      );

      assert.instanceOf(error, DocumentLoadError);
    });
  });

  context('given no registry', function () {
    specify('should resolve fields of the source description only', async function () {
      const withoutRegistry = new RuntimeExpressionEvaluator(
        {},
        { document: entryDoc, strict: false },
      );

      assert.isUndefined(
        await withoutRegistry.evaluate('$sourceDescriptions.petstoreAPI.getPetById'),
      );
      assert.strictEqual(
        await withoutRegistry.evaluate('$sourceDescriptions.petstoreAPI.url'),
        entryDoc.resolveSourceDescriptionURI('petstoreAPI'),
      );
      assert.strictEqual(openapi.loads.size, 0);
    });
  });
});
