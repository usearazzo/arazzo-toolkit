import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { ParseResultElement } from '@speclynx/apidom-datamodel';
import { toValue } from '@speclynx/apidom-core';
import {
  isOpenApi3_1Element,
  isPathItemElement,
  mediaTypes,
  OpenApi3_1Element,
  OperationElement,
  PathItemElement,
} from '@speclynx/apidom-ns-openapi-3-1';
import { ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';
import { parseArazzo, parseOpenAPI } from '@usearazzo/parser';

import { resolveOpenAPI, resolveOpenAPIElement, ResolveError } from '../../src/index.ts';
import { createHTTPServer, type ServerTerminable } from '../helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('resolveOpenAPI', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'resolve-openapi');

  context('given file system path to JSON file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ReferenceSet', async function () {
      const result = await resolveOpenAPI(rootFilePath);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain OpenApi3_1Element as root api', async function () {
      const result = await resolveOpenAPI(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isOpenApi3_1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveOpenAPI(rootFilePath);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'limit.json')));
    });

    specify('should set retrievalURI metadata', async function () {
      const result = await resolveOpenAPI(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.strictEqual(parseResult.meta.get('retrievalURI'), rootFilePath);
    });

    specify('should leave references in place', async function () {
      const result = await resolveOpenAPI(rootFilePath);
      const api = (result.rootRef!.value as ParseResultElement).api as OpenApi3_1Element;
      const operation = (api.paths!.get('/users') as PathItemElement).getField as OperationElement;

      assert.deepEqual(toValue(operation.parameters!.get(0)), { $ref: './limit.json' });
    });

    specify('should ignore seeded dereference.refSet', async function () {
      const refSet = new ReferenceSet();
      const result = await resolveOpenAPI(rootFilePath, { dereference: { refSet } });

      assert.notStrictEqual(result, refSet);
      assert.strictEqual(result.size, 2);
      assert.strictEqual(refSet.size, 0);
    });

    context('given relative file system path', function () {
      // relative to the working directory mocha runs from
      const relativePath = path.relative(process.cwd(), rootFilePath);

      for (const source of [relativePath, `./${relativePath}`]) {
        specify(`should resolve "${source}" against the working directory`, async function () {
          const result = await resolveOpenAPI(source);
          const parseResult = result.rootRef!.value as ParseResultElement;

          assert.isTrue(isOpenApi3_1Element(parseResult.api));
          assert.strictEqual(parseResult.meta.get('retrievalURI'), rootFilePath);
        });
      }
    });
  });

  context('given file system path to YAML file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.yaml');

    specify('should return ReferenceSet', async function () {
      const result = await resolveOpenAPI(rootFilePath);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain OpenApi3_1Element as root api', async function () {
      const result = await resolveOpenAPI(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isOpenApi3_1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveOpenAPI(rootFilePath);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'limit.json')));
    });
  });

  context('given HTTP URL to JSON file', function () {
    let server: ServerTerminable;

    beforeEach(async function () {
      server = await createHTTPServer({ cwd: fixturesPath });
    });

    afterEach(async function () {
      await server.terminate();
    });

    specify('should return ReferenceSet', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.json`);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain OpenApi3_1Element as root api', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.json`);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isOpenApi3_1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.json`);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(`http://localhost:${server.port}/root.json`));
      assert.isTrue(result.has(`http://localhost:${server.port}/limit.json`));
    });
  });

  context('given HTTP URL to YAML file', function () {
    let server: ServerTerminable;

    beforeEach(async function () {
      server = await createHTTPServer({ cwd: fixturesPath });
    });

    afterEach(async function () {
      await server.terminate();
    });

    specify('should return ReferenceSet', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.yaml`);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain OpenApi3_1Element as root api', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.yaml`);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isOpenApi3_1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveOpenAPI(`http://localhost:${server.port}/root.yaml`);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(`http://localhost:${server.port}/root.yaml`));
      assert.isTrue(result.has(`http://localhost:${server.port}/limit.json`));
    });
  });

  context('given non-OpenAPI document', function () {
    const arazzoFilePath = path.join(__dirname, 'fixtures', 'resolve', 'root.json');

    specify('should throw ResolveError', async function () {
      try {
        await resolveOpenAPI(arazzoFilePath);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, arazzoFilePath);
        assert.instanceOf((error as ResolveError).cause, Error);
      }
    });
  });

  context('given invalid URI', function () {
    specify('should throw ResolveError', async function () {
      try {
        await resolveOpenAPI('/non/existent/path.json');
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, '/non/existent/path.json');
        assert.instanceOf((error as ResolveError).cause, Error);
      }
    });
  });
});

/**
 * Test cases for resolveOpenAPIElement:
 *
 * | Case | Scenario                                              | Expected behavior            |
 * |------|-------------------------------------------------------|------------------------------|
 * | 1    | ParseResultElement + retrievalURI                     | uses retrievalURI as baseURI |
 * | 2    | ParseResultElement - retrievalURI + baseURI           | uses provided baseURI        |
 * | 3    | ParseResultElement - retrievalURI - baseURI           | throws ResolveError          |
 * | 4    | Child element + parseResult + retrievalURI            | resolves against root URI    |
 * | 5    | Child element + parseResult - retrievalURI + baseURI  | resolves against baseURI     |
 * | 6    | Child element + parseResult - retrievalURI - baseURI  | throws ResolveError          |
 * | 7    | Child element - parseResult + baseURI + mediaType     | resolves against baseURI     |
 * | 8    | Child element - parseResult - baseURI                 | throws ResolveError          |
 * | 9    | ParseResultElement of a non-OpenAPI document          | throws ResolveError          |
 */
describe('resolveOpenAPIElement', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'resolve-openapi');
  const openapiObject = {
    openapi: '3.1.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          responses: {
            '200': {
              description: 'Successful response',
            },
          },
        },
      },
    },
  };

  context('given ParseResultElement with retrievalURI metadata', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ReferenceSet', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const result = await resolveOpenAPIElement(parseResult);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain OpenApi3_1Element as root api', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const result = await resolveOpenAPIElement(parseResult);
      const rootParseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isOpenApi3_1Element(rootParseResult.api));
    });

    specify('should resolve external references', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const result = await resolveOpenAPIElement(parseResult);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'limit.json')));
    });

    specify(
      'should hold the input element as root reference and leave it untouched',
      async function () {
        const parseResult = await parseOpenAPI(rootFilePath);
        const result = await resolveOpenAPIElement(parseResult);
        const api = parseResult.api as OpenApi3_1Element;
        const operation = (api.paths!.get('/users') as PathItemElement)
          .getField as OperationElement;

        assert.strictEqual(result.rootRef!.value, parseResult);
        assert.deepEqual(toValue(operation.parameters!.get(0)), { $ref: './limit.json' });
      },
    );

    specify('should ignore seeded dereference.refSet', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const refSet = new ReferenceSet();
      const result = await resolveOpenAPIElement(parseResult, { dereference: { refSet } });

      assert.notStrictEqual(result, refSet);
      assert.strictEqual(result.size, 2);
      assert.strictEqual(refSet.size, 0);
    });
  });

  context('given child element with parseResult in strategyOpts', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should resolve external references of child element', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      // pass parseResult via strategyOpts so the child element resolves against the root URI
      const result = await resolveOpenAPIElement(pathItem, {
        dereference: { strategyOpts: { parseResult } },
      });

      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.rootRef!.uri, rootFilePath);
      assert.isTrue(result.has(path.join(fixturesPath, 'limit.json')));
    });

    specify('should wrap the child element in the root reference', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      const result = await resolveOpenAPIElement(pathItem, {
        dereference: { strategyOpts: { parseResult } },
      });
      const rootParseResult = result.rootRef!.value as ParseResultElement;
      const operation = pathItem.getField as OperationElement;

      assert.notStrictEqual(rootParseResult, parseResult);
      assert.isTrue(isPathItemElement(rootParseResult.result));
      assert.deepEqual(toValue(operation.parameters!.get(0)), { $ref: './limit.json' });
    });
  });

  context('given child element without parseResult in strategyOpts', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      try {
        await resolveOpenAPIElement(pathItem);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI and mediaType when provided', async function () {
      const parseResult = await parseOpenAPI(rootFilePath);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      const result = await resolveOpenAPIElement(pathItem, {
        resolve: { baseURI: rootFilePath },
        parse: { mediaType: mediaTypes.latest() },
      });

      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.rootRef!.uri, rootFilePath);
      assert.isTrue(result.has(path.join(fixturesPath, 'limit.json')));
    });
  });

  context('given ParseResultElement of a non-OpenAPI document', function () {
    const arazzoFilePath = path.join(__dirname, 'fixtures', 'resolve', 'root.json');

    specify('should throw ResolveError', async function () {
      const parseResult = await parseArazzo(arazzoFilePath);

      try {
        await resolveOpenAPIElement(parseResult);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.instanceOf((error as ResolveError).cause, Error);
      }
    });
  });

  context('given child element with parseResult without retrievalURI metadata', function () {
    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseOpenAPI(openapiObject);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      try {
        await resolveOpenAPIElement(pathItem, {
          dereference: { strategyOpts: { parseResult } },
        });
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI when provided', async function () {
      const parseResult = await parseOpenAPI(openapiObject);
      const api = parseResult.api as OpenApi3_1Element;
      const pathItem = api.paths!.get('/users') as PathItemElement;

      const result = await resolveOpenAPIElement(pathItem, {
        resolve: { baseURI: 'https://example.com/openapi.json' },
        dereference: { strategyOpts: { parseResult } },
      });

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.rootRef!.uri, 'https://example.com/openapi.json');
    });
  });

  context('given ParseResultElement without retrievalURI metadata', function () {
    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseOpenAPI(openapiObject);

      try {
        await resolveOpenAPIElement(parseResult);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI when provided', async function () {
      const parseResult = await parseOpenAPI(openapiObject);
      const result = await resolveOpenAPIElement(parseResult, {
        resolve: { baseURI: 'https://example.com/openapi.json' },
      });
      const rootParseResult = result.rootRef!.value as ParseResultElement;

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.rootRef!.uri, 'https://example.com/openapi.json');
      assert.isTrue(isOpenApi3_1Element(rootParseResult.api));
    });
  });
});
