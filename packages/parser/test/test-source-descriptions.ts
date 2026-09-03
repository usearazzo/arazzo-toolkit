import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { isParseResultElement, ParseResultElement } from '@speclynx/apidom-datamodel';
import {
  isArazzoSpecification1Element,
  type ArazzoSpecification1Element,
} from '@speclynx/apidom-ns-arazzo-1';
import { isOpenApi3_1Element } from '@speclynx/apidom-ns-openapi-3-1';

import { parseArazzo } from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, 'fixtures', 'source-descriptions');

const inlineYAML = (name: string, url: string) => `arazzo: 1.0.1
info:
  title: x
  version: "1"
sourceDescriptions:
  - name: ${name}
    type: openapi
    url: ${url}
workflows: []`;

describe('parse', function () {
  context('given sourceDescriptions option', function () {
    context('when sourceDescriptions is false (default)', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-openapi.json');

      specify('should not parse source descriptions', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: false },
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

      specify('should parse all source descriptions', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
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
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
            },
          },
        });

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(sdParseResult.meta.get('name'), 'petStore');
        assert.strictEqual(sdParseResult.meta.get('type'), 'openapi');
      });

      specify('should work with global parserOpts flag', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
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
        assert.strictEqual(sdParseResult.meta.get('name'), 'petStore');
      });
    });

    context('when sourceDescriptions is array of names', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-multiple-sources.json');

      specify('should parse only named source descriptions', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: ['petStore'] },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo document + 1 selected source description (petStore only)
        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(sdParseResult.meta.get('name'), 'petStore');
      });
    });

    context('when source description is of type arazzo', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-arazzo.json');

      specify('should recursively parse arazzo source descriptions', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
              'arazzo-yaml-1': { sourceDescriptions: true },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo + child arazzo
        assert.strictEqual(result.length, 2);

        // verify child arazzo was parsed
        const childArazzo = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(childArazzo));
        assert.strictEqual(childArazzo.meta.get('name'), 'childWorkflows');
        assert.strictEqual(childArazzo.meta.get('type'), 'arazzo');
        assert.isTrue(isArazzoSpecification1Element(childArazzo.api));

        // verify child's openapi source description was recursively parsed (nested under childArazzo)
        assert.strictEqual(childArazzo.length, 2); // arazzo api + nested openapi
        const nestedOpenApi = childArazzo.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(nestedOpenApi));
        assert.isTrue(nestedOpenApi.classes.includes('source-description'));
        assert.strictEqual(nestedOpenApi.meta.get('name'), 'childApi');
        assert.strictEqual(nestedOpenApi.meta.get('type'), 'openapi');
        // openapi was successfully parsed (no errors, api is OpenAPI 3.1 element)
        assert.strictEqual(nestedOpenApi.errors.length, 0);
        assert.isTrue(isOpenApi3_1Element(nestedOpenApi.api));
      });
    });

    context('when source descriptions have circular references', function () {
      const fixturePath = path.join(fixturesPath, 'cycle-a.json');

      specify('should detect cycles and add warning annotation', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
              'arazzo-yaml-1': { sourceDescriptions: true },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo (cycle-a) + cycle-b source description
        assert.strictEqual(result.length, 2);

        // cycle-b's parse result contains the cycle-a reference which triggers cycle detection
        const cycleBParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(cycleBParseResult));
        assert.isTrue(cycleBParseResult.classes.includes('source-description'));

        // the nested parse result for cycle-a should contain the cycle warning
        const nestedParseResult = cycleBParseResult.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(nestedParseResult));

        // check for the cycle detection warning annotation
        const annotation = nestedParseResult.get(0);
        assert.strictEqual(annotation?.element, 'annotation');
        assert.isTrue(annotation?.classes?.includes('warning'));
        assert.isTrue(String(annotation?.toValue()).includes('already been visited'));
      });
    });

    context('when source descriptions share a document', function () {
      const fixturePath = path.join(fixturesPath, 'shared-a.json');

      specify(
        'should parse the shared document once and point later references at it',
        async function () {
          const result = await parseArazzo(fixturePath, {
            parse: { parserOpts: { sourceDescriptions: true } },
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
          assert.isTrue(isParseResultElement(petStoreApi));
          assert.isTrue(petStoreApi.classes.includes('source-description'));
          assert.strictEqual(petStoreApi.meta.get('name'), 'petStoreApi');
          assert.strictEqual(
            petStoreApi.meta.get('retrievalURI'),
            path.join(fixturesPath, 'openapi.json'),
          );
          assert.isUndefined(petStoreApi.api); // not re-parsed
          assert.strictEqual(petStoreApi.warnings.length, 0); // not a cycle
          assert.strictEqual(petStoreApi.meta.get('parseResult'), petStore);

          const annotation = petStoreApi.get(0);
          assert.strictEqual(annotation?.element, 'annotation');
          assert.isTrue(annotation?.classes?.includes('info'));
          assert.isTrue(String(annotation?.toValue()).includes('already been parsed'));

          // the parsed document is reachable from shared-b's source description element
          const sourceDescription = (
            sharedB.api as ArazzoSpecification1Element
          ).sourceDescriptions!.get(0);
          assert.strictEqual(sourceDescription.meta.get('parseResult'), petStore);
        },
      );

      specify(
        'should still report the reference back to an ancestor as a cycle',
        async function () {
          const result = await parseArazzo(fixturePath, {
            parse: { parserOpts: { sourceDescriptions: true } },
          });

          const sharedB = result.get(2) as ParseResultElement;
          const sharedA = sharedB.get(2) as ParseResultElement;
          assert.strictEqual(sharedA.meta.get('name'), 'sharedA');
          assert.isUndefined(sharedA.api);
          assert.isUndefined(sharedA.meta.get('parseResult'));

          const annotation = sharedA.get(0);
          assert.strictEqual(annotation?.element, 'annotation');
          assert.isTrue(annotation?.classes?.includes('warning'));
          assert.isTrue(String(annotation?.toValue()).includes('already been visited'));
        },
      );
    });

    context('when source description references its own document', function () {
      const fixturePath = path.join(fixturesPath, 'cycle-self.json');

      specify('should detect self-reference and add warning annotation', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo + self source description
        assert.strictEqual(result.length, 2);

        // the self-referencing source description is skipped with a warning annotation
        const selfParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(selfParseResult));
        assert.isTrue(selfParseResult.classes.includes('source-description'));
        assert.isUndefined(selfParseResult.api); // not re-parsed

        const annotation = selfParseResult.get(0);
        assert.strictEqual(annotation?.element, 'annotation');
        assert.isTrue(annotation?.classes?.includes('warning'));
        assert.isTrue(String(annotation?.toValue()).includes('already been visited'));
      });
    });

    context('when circular references span YAML and JSON documents', function () {
      const fixturePath = path.join(fixturesPath, 'cycle-cross-a.yaml');

      specify('should detect cycles across parsers and add warning annotation', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true },
              'arazzo-yaml-1': { sourceDescriptions: true },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo (cycle-cross-a) + cycle-cross-b source description
        assert.strictEqual(result.length, 2);

        // cycle-cross-b was parsed by the JSON parser but shares recursion state
        // with the YAML parser that parsed cycle-cross-a
        const cycleBParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(cycleBParseResult));
        assert.isTrue(cycleBParseResult.classes.includes('source-description'));
        assert.isTrue(isArazzoSpecification1Element(cycleBParseResult.api));

        // the nested parse result for cycle-cross-a should contain the cycle warning
        const nestedParseResult = cycleBParseResult.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(nestedParseResult));

        const annotation = nestedParseResult.get(0);
        assert.strictEqual(annotation?.element, 'annotation');
        assert.isTrue(annotation?.classes?.includes('warning'));
        assert.isTrue(String(annotation?.toValue()).includes('already been visited'));
      });
    });

    context('when sourceDescriptionsMaxDepth is set', function () {
      const fixturePath = path.join(fixturesPath, 'arazzo-with-arazzo.json');

      specify('should limit recursion depth', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true, sourceDescriptionsMaxDepth: 1 },
              'arazzo-yaml-1': { sourceDescriptions: true, sourceDescriptionsMaxDepth: 1 },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo + child arazzo only (depth 1 stops further recursion)
        assert.strictEqual(result.length, 2);

        const childArazzo = result.get(1) as ParseResultElement;
        assert.isTrue(isArazzoSpecification1Element(childArazzo.api));
      });

      specify('should not parse any source descriptions when maxDepth is 0', async function () {
        const result = await parseArazzo(fixturePath, {
          parse: {
            parserOpts: {
              'arazzo-json-1': { sourceDescriptions: true, sourceDescriptionsMaxDepth: 0 },
            },
          },
        });

        assert.isTrue(isParseResultElement(result));
        // main arazzo document + error annotation for exceeded depth
        assert.strictEqual(result.length, 2);

        // the source description parse result should contain an error annotation
        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isTrue(isParseResultElement(sdParseResult));
        assert.isUndefined(sdParseResult.api); // no parsed document due to depth limit

        const annotation = sdParseResult.get(0);
        assert.strictEqual(annotation?.element, 'annotation');
        assert.isTrue(annotation?.classes?.includes('error'));
      });
    });

    context('when inline source has a relative source description URL', function () {
      const doc = {
        arazzo: '1.0.1',
        info: { title: 'x', version: '1' },
        sourceDescriptions: [{ name: 'gone', type: 'openapi', url: './nope.yaml' }],
        workflows: [],
      };

      specify(
        'should add error annotation instead of serving the parent document',
        async function () {
          const result = await parseArazzo(doc, {
            parse: { parserOpts: { sourceDescriptions: true } },
          });

          assert.strictEqual(result.length, 2);

          // the relative URL resolves against the synthetic memory:// base and is then rejected
          const sdParseResult = result.get(1) as ParseResultElement;
          assert.isTrue(isParseResultElement(sdParseResult));
          assert.isTrue(sdParseResult.classes.includes('source-description'));
          assert.strictEqual(
            sdParseResult.meta.get('retrievalURI'),
            'memory://arazzo.json/nope.yaml',
          );
          assert.isUndefined(sdParseResult.api); // not re-parsed as the parent document

          const annotation = sdParseResult.get(0);
          assert.strictEqual(annotation?.element, 'annotation');
          assert.isTrue(annotation?.classes?.includes('error'));
          assert.strictEqual(
            annotation?.toValue(),
            'Error parsing source description "memory://arazzo.json/nope.yaml": relative URL cannot be resolved because the parent document was parsed from inline content. Provide resolve.baseURI or an absolute $self.',
          );
        },
      );

      specify('should behave the same for inline YAML', async function () {
        const result = await parseArazzo(inlineYAML('gone', './nope.yaml'), {
          parse: { parserOpts: { sourceDescriptions: true } },
        });

        assert.strictEqual(result.length, 2);

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(
          sdParseResult.meta.get('retrievalURI'),
          'memory://arazzo.yaml/nope.yaml',
        );
        assert.isUndefined(sdParseResult.api);

        const annotation = sdParseResult.get(0);
        assert.strictEqual(annotation?.element, 'annotation');
        assert.isTrue(annotation?.classes?.includes('error'));
      });
    });

    context('when inline source is parsed with resolve.baseURI', function () {
      const doc = {
        arazzo: '1.0.1',
        info: { title: 'x', version: '1' },
        sourceDescriptions: [{ name: 'petStore', type: 'openapi', url: './openapi.json' }],
        workflows: [],
      };
      // the file does not exist; the in-memory document is served under this URI
      const baseURI = path.join(fixturesPath, 'arazzo.json');
      const expectedSourceDescriptionURI = path.join(fixturesPath, 'openapi.json');

      const cases: [string, string | Record<string, unknown>, string][] = [
        ['object', doc, baseURI],
        ['object with extensionless baseURI', doc, path.join(fixturesPath, 'arazzo')],
        ['inline YAML', inlineYAML('petStore', './openapi.json'), baseURI],
      ];

      for (const [label, source, base] of cases) {
        specify(`should resolve relative source description URLs (${label})`, async function () {
          const result = await parseArazzo(source, {
            resolve: { baseURI: base },
            parse: { parserOpts: { sourceDescriptions: true } },
          });

          assert.strictEqual(result.length, 2);
          assert.isTrue(isArazzoSpecification1Element(result.api));
          assert.strictEqual(result.meta.get('retrievalURI'), base);

          const sdParseResult = result.get(1) as ParseResultElement;
          assert.isTrue(sdParseResult.classes.includes('source-description'));
          assert.strictEqual(sdParseResult.meta.get('retrievalURI'), expectedSourceDescriptionURI);
          assert.strictEqual(sdParseResult.errors.length, 0);
          assert.isTrue(isOpenApi3_1Element(sdParseResult.api));
        });
      }

      specify(
        'should serve the in-memory document even when baseURI exists on disk',
        async function () {
          const result = await parseArazzo(
            { ...doc, info: { title: 'in-memory', version: '1' } },
            {
              // a real file with a different title; FileResolver could read it
              resolve: { baseURI: path.join(fixturesPath, 'arazzo-with-openapi.json') },
            },
          );

          assert.isTrue(isArazzoSpecification1Element(result.api));
          const api = result.api as ArazzoSpecification1Element;
          assert.strictEqual(api.info!.title!.toValue(), 'in-memory');
        },
      );

      specify('should serve the in-memory document with custom resolvers', async function () {
        // no resolver can fetch the sibling, but the parent itself must still be served
        const result = await parseArazzo(doc, {
          resolve: { baseURI: 'https://example.com/api/arazzo.json', resolvers: [] },
          parse: { parserOpts: { sourceDescriptions: true } },
        });

        assert.isTrue(isArazzoSpecification1Element(result.api));
        assert.strictEqual(result.meta.get('retrievalURI'), 'https://example.com/api/arazzo.json');

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.strictEqual(
          sdParseResult.meta.get('retrievalURI'),
          'https://example.com/api/openapi.json',
        );
        assert.isUndefined(sdParseResult.api);
        assert.isTrue(
          String(sdParseResult.get(0)?.toValue()).includes('Could not find a resolver'),
        );
      });

      specify('should detect a source description referencing baseURI itself', async function () {
        const result = await parseArazzo(
          { ...doc, sourceDescriptions: [{ name: 'self', type: 'arazzo', url: './arazzo.json' }] },
          {
            resolve: { baseURI },
            parse: { parserOpts: { sourceDescriptions: true } },
          },
        );

        const sdParseResult = result.get(1) as ParseResultElement;
        assert.isUndefined(sdParseResult.api); // not re-parsed
        assert.isTrue(String(sdParseResult.get(0)?.toValue()).includes('already been visited'));
      });
    });
  });
});
