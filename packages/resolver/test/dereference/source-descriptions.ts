import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { isParseResultElement, ParseResultElement } from '@speclynx/apidom-datamodel';
import { isArazzoSpecification1Element } from '@speclynx/apidom-ns-arazzo-1';
import { isSwaggerElement } from '@speclynx/apidom-ns-openapi-2';
import { isOpenApi3_0Element } from '@speclynx/apidom-ns-openapi-3-0';
import { isOpenApi3_1Element } from '@speclynx/apidom-ns-openapi-3-1';

import { dereferenceArazzo } from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, 'fixtures', 'source-descriptions');

describe('dereferenceArazzo', function () {
  context('given sourceDescriptions option', function () {
    context('when sourceDescriptions is false (default)', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi.json');

      specify('should not dereference source descriptions', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: false,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
        // only the main arazzo document should be in the result
        assert.strictEqual(result.length, 1);
      });
    });

    context('when sourceDescriptions is true', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi.json');

      specify('should dereference all source descriptions', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
        // main arazzo document + 1 source description
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(sdParseResult));
        assert.isTrue(sdParseResult.classes.includes('source-description'));
      });

      specify('should include source description metadata', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(sdParseResult.meta.get('name'), 'petStore');
        assert.strictEqual(sdParseResult.meta.get('type'), 'openapi');
      });
    });

    context('when sourceDescriptions is array of names', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-multiple-sources.json');

      specify('should dereference only named source descriptions', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: ['petStore'],
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo document + 1 selected source description (petStore only)
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(sdParseResult.meta.get('name'), 'petStore');
      });

      specify('should dereference multiple named source descriptions', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: ['petStore', 'inventoryApi'],
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo document + 2 source descriptions
        assert.strictEqual(result.length, 3);
      });
    });

    context('when using strategy-specific options', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi.json');

      specify('should accept arazzo-1 specific options', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              'arazzo-1': {
                sourceDescriptions: true,
              },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
        // main arazzo document + 1 source description
        assert.strictEqual(result.length, 2);
      });
    });

    context('when source description is OpenAPI 2.0 (Swagger)', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi-2.0.json');

      specify('should dereference OpenAPI 2.0 source description', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(sdParseResult));
        assert.isTrue(isSwaggerElement(sdParseResult.api));
      });
    });

    context('when source description is OpenAPI 3.0', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi-3.0.json');

      specify('should dereference OpenAPI 3.0 source description', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(sdParseResult));
        assert.isTrue(isOpenApi3_0Element(sdParseResult.api));
      });
    });

    context('when source description is OpenAPI 3.1', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi.json');

      specify('should dereference OpenAPI 3.1 source description', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(sdParseResult));
        assert.isTrue(isOpenApi3_1Element(sdParseResult.api));
      });
    });

    context('when source description is Arazzo (nested)', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-arazzo.json');

      specify('should recursively dereference Arazzo source descriptions', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo + child arazzo
        assert.strictEqual(result.length, 2);

        const childArazzo = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(childArazzo));
        assert.isTrue(isArazzoSpecification1Element(childArazzo.api));
        assert.strictEqual(childArazzo.meta.get('name'), 'childWorkflows');
        assert.strictEqual(childArazzo.meta.get('type'), 'arazzo');
      });
    });

    context('when source descriptions have circular references', function () {
      const fixturePath = path.join(fixturesPath, 'cycle-a.json');

      specify('should detect cycles and not hang', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
      });
    });

    context('when source descriptions share a document', function () {
      const fixturePath = path.join(fixturesPath, 'shared-a.json');

      specify(
        'should dereference the shared document once and point later references at it',
        async function () {
          const result = await dereferenceArazzo(fixturePath, {
            dereference: {
              strategyOpts: {
                sourceDescriptions: true,
              },
            },
          });

          // shared-a + petStore + shared-b
          assert.strictEqual(result.length, 3);

          const petStore = result.get(1) as ParseResultElement;
          assert.strictEqual(petStore.meta.get('name'), 'petStore');
          assert.isTrue(isOpenApi3_1Element(petStore.api));

          // shared-b references the same OpenAPI document through a different path (diamond)
          const sharedB = result.get(2) as ParseResultElement;
          assert.isTrue(isArazzoSpecification1Element(sharedB.api));
          assert.strictEqual(sharedB.length, 3);

          const petStoreApi = sharedB.get(1) as ParseResultElement;
          assert.isTrue(petStoreApi.classes.includes('source-description'));
          assert.strictEqual(petStoreApi.meta.get('name'), 'petStoreApi');
          assert.isUndefined(petStoreApi.api); // not dereferenced again
          assert.strictEqual(petStoreApi.warnings.length, 0); // not a cycle
          assert.strictEqual(petStoreApi.meta.get('parseResult'), petStore);

          const annotation = petStoreApi.get(0);
          assert.strictEqual(annotation?.element, 'annotation');
          assert.isTrue(annotation?.classes?.includes('info'));
          assert.isTrue(String(annotation?.toValue()).includes('already been dereferenced'));

          // the reference back to shared-a is still a cycle
          const sharedA = sharedB.get(2) as ParseResultElement;
          assert.isUndefined(sharedA.api);
          assert.isUndefined(sharedA.meta.get('parseResult'));
          assert.isTrue(sharedA.get(0)?.classes?.includes('warning'));
          assert.isTrue(String(sharedA.get(0)?.toValue()).includes('already been visited'));
        },
      );
    });

    context('when sourceDescriptionsMaxDepth is set', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-arazzo.json');

      specify('should limit recursion depth', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
              sourceDescriptionsMaxDepth: 1,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
      });

      specify('should not dereference when maxDepth is 0', async function () {
        const result = await dereferenceArazzo(fixturePath, {
          dereference: {
            strategyOpts: {
              sourceDescriptions: true,
              sourceDescriptionsMaxDepth: 0,
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        assert.isTrue(isArazzoSpecification1Element(result.api));
      });
    });
  });
});
