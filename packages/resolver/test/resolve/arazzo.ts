import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { ParseResultElement } from '@speclynx/apidom-datamodel';
import { toValue } from '@speclynx/apidom-core';
import {
  isArazzoSpecification1Element,
  isWorkflowElement,
  mediaTypes,
  ArazzoSpecification1Element,
  WorkflowElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { ReferenceSet } from '@speclynx/apidom-reference/configuration/empty';
import { parseArazzo, parseOpenAPI } from '@usearazzo/parser';

import { resolveArazzo, resolveArazzoElement, ResolveError } from '../../src/index.ts';
import { createHTTPServer, type ServerTerminable } from '../helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('resolveArazzo', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'resolve');

  context('given file system path to JSON file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ReferenceSet', async function () {
      const result = await resolveArazzo(rootFilePath);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain ArazzoSpecification1Element as root api', async function () {
      const result = await resolveArazzo(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isArazzoSpecification1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveArazzo(rootFilePath);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'inputs.json')));
    });

    specify('should set retrievalURI metadata', async function () {
      const result = await resolveArazzo(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.strictEqual(parseResult.meta.get('retrievalURI'), rootFilePath);
    });

    specify('should leave references in place', async function () {
      const result = await resolveArazzo(rootFilePath);
      const api = (result.rootRef!.value as ParseResultElement).api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      assert.deepEqual(toValue(workflow.inputs), { $ref: './inputs.json' });
    });

    specify('should ignore seeded dereference.refSet', async function () {
      const refSet = new ReferenceSet();
      const result = await resolveArazzo(rootFilePath, { dereference: { refSet } });

      assert.notStrictEqual(result, refSet);
      assert.strictEqual(result.size, 2);
      assert.strictEqual(refSet.size, 0);
    });

    context('given relative file system path', function () {
      // relative to the working directory mocha runs from
      const relativePath = path.relative(process.cwd(), rootFilePath);

      for (const source of [relativePath, `./${relativePath}`]) {
        specify(`should resolve "${source}" against the working directory`, async function () {
          const result = await resolveArazzo(source);
          const parseResult = result.rootRef!.value as ParseResultElement;

          assert.isTrue(isArazzoSpecification1Element(parseResult.api));
          assert.strictEqual(parseResult.meta.get('retrievalURI'), rootFilePath);
        });
      }
    });
  });

  context('given file system path to YAML file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.yaml');

    specify('should return ReferenceSet', async function () {
      const result = await resolveArazzo(rootFilePath);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain ArazzoSpecification1Element as root api', async function () {
      const result = await resolveArazzo(rootFilePath);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isArazzoSpecification1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveArazzo(rootFilePath);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'inputs.json')));
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
      const result = await resolveArazzo(`http://localhost:${server.port}/root.json`);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain ArazzoSpecification1Element as root api', async function () {
      const result = await resolveArazzo(`http://localhost:${server.port}/root.json`);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isArazzoSpecification1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveArazzo(`http://localhost:${server.port}/root.json`);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(`http://localhost:${server.port}/root.json`));
      assert.isTrue(result.has(`http://localhost:${server.port}/inputs.json`));
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
      const result = await resolveArazzo(`http://localhost:${server.port}/root.yaml`);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain ArazzoSpecification1Element as root api', async function () {
      const result = await resolveArazzo(`http://localhost:${server.port}/root.yaml`);
      const parseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isArazzoSpecification1Element(parseResult.api));
    });

    specify('should resolve external references', async function () {
      const result = await resolveArazzo(`http://localhost:${server.port}/root.yaml`);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(`http://localhost:${server.port}/root.yaml`));
      assert.isTrue(result.has(`http://localhost:${server.port}/inputs.json`));
    });
  });

  context('given non-Arazzo document', function () {
    const openapiFilePath = path.join(__dirname, 'fixtures', 'resolve-openapi', 'root.json');

    specify('should throw ResolveError', async function () {
      try {
        await resolveArazzo(openapiFilePath);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, openapiFilePath);
        assert.instanceOf((error as ResolveError).cause, Error);
      }
    });
  });

  context('given invalid URI', function () {
    specify('should throw ResolveError', async function () {
      try {
        await resolveArazzo('/non/existent/path.json');
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
 * Test cases for resolveArazzoElement:
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
 * | 9    | ParseResultElement of a non-Arazzo document           | throws ResolveError          |
 */
describe('resolveArazzoElement', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'resolve');
  const arazzoObject = {
    arazzo: '1.0.1',
    info: {
      title: 'Test API Workflow',
      version: '1.0.0',
    },
    sourceDescriptions: [
      {
        name: 'testApi',
        type: 'openapi',
        url: 'https://example.com/openapi.json',
      },
    ],
    workflows: [
      {
        workflowId: 'test-workflow',
        inputs: {
          type: 'object',
          properties: {
            resourceId: { type: 'string' },
          },
        },
        steps: [
          {
            stepId: 'step1',
            operationId: 'getResource',
            parameters: [
              {
                name: 'resourceId',
                in: 'path',
                value: '$inputs.resourceId',
              },
            ],
          },
        ],
      },
    ],
  };

  context('given ParseResultElement with retrievalURI metadata', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ReferenceSet', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const result = await resolveArazzoElement(parseResult);

      assert.instanceOf(result, ReferenceSet);
    });

    specify('should contain ArazzoSpecification1Element as root api', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const result = await resolveArazzoElement(parseResult);
      const rootParseResult = result.rootRef!.value as ParseResultElement;

      assert.isTrue(isArazzoSpecification1Element(rootParseResult.api));
    });

    specify('should resolve external references', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const result = await resolveArazzoElement(parseResult);

      assert.strictEqual(result.size, 2);
      assert.isTrue(result.has(rootFilePath));
      assert.isTrue(result.has(path.join(fixturesPath, 'inputs.json')));
    });

    specify(
      'should hold the input element as root reference and leave it untouched',
      async function () {
        const parseResult = await parseArazzo(rootFilePath);
        const result = await resolveArazzoElement(parseResult);
        const api = parseResult.api as ArazzoSpecification1Element;
        const workflow = api.workflows!.get(0) as WorkflowElement;

        assert.strictEqual(result.rootRef!.value, parseResult);
        assert.deepEqual(toValue(workflow.inputs), { $ref: './inputs.json' });
      },
    );

    specify('should ignore seeded dereference.refSet', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const refSet = new ReferenceSet();
      const result = await resolveArazzoElement(parseResult, { dereference: { refSet } });

      assert.notStrictEqual(result, refSet);
      assert.strictEqual(result.size, 2);
      assert.strictEqual(refSet.size, 0);
    });
  });

  context('given child element with parseResult in strategyOpts', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should resolve external references of child element', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      // pass parseResult via strategyOpts so the child element resolves against the root URI
      const result = await resolveArazzoElement(workflow, {
        dereference: { strategyOpts: { parseResult } },
      });

      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.rootRef!.uri, rootFilePath);
      assert.isTrue(result.has(path.join(fixturesPath, 'inputs.json')));
    });

    specify('should wrap the child element in the root reference', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      const result = await resolveArazzoElement(workflow, {
        dereference: { strategyOpts: { parseResult } },
      });
      const rootParseResult = result.rootRef!.value as ParseResultElement;

      assert.notStrictEqual(rootParseResult, parseResult);
      assert.isTrue(isWorkflowElement(rootParseResult.result));
      assert.deepEqual(toValue(workflow.inputs), { $ref: './inputs.json' });
    });
  });

  context('given child element without parseResult in strategyOpts', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      try {
        await resolveArazzoElement(workflow);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI and mediaType when provided', async function () {
      const parseResult = await parseArazzo(rootFilePath);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      const result = await resolveArazzoElement(workflow, {
        resolve: { baseURI: rootFilePath },
        parse: { mediaType: mediaTypes.latest() },
      });

      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.rootRef!.uri, rootFilePath);
      assert.isTrue(result.has(path.join(fixturesPath, 'inputs.json')));
    });
  });

  context('given ParseResultElement of a non-Arazzo document', function () {
    const openapiFilePath = path.join(__dirname, 'fixtures', 'resolve-openapi', 'root.json');

    specify('should throw ResolveError', async function () {
      const parseResult = await parseOpenAPI(openapiFilePath);

      try {
        await resolveArazzoElement(parseResult);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.instanceOf((error as ResolveError).cause, Error);
      }
    });
  });

  context('given child element with parseResult without retrievalURI metadata', function () {
    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseArazzo(arazzoObject);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      try {
        await resolveArazzoElement(workflow, {
          dereference: { strategyOpts: { parseResult } },
        });
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI when provided', async function () {
      const parseResult = await parseArazzo(arazzoObject);
      const api = parseResult.api as ArazzoSpecification1Element;
      const workflow = api.workflows!.get(0) as WorkflowElement;

      const result = await resolveArazzoElement(workflow, {
        resolve: { baseURI: 'https://example.com/arazzo.json' },
        dereference: { strategyOpts: { parseResult } },
      });

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.rootRef!.uri, 'https://example.com/arazzo.json');
    });
  });

  context('given ParseResultElement without retrievalURI metadata', function () {
    specify('should throw ResolveError when baseURI not provided', async function () {
      const parseResult = await parseArazzo(arazzoObject);

      try {
        await resolveArazzoElement(parseResult);
        assert.fail('Expected ResolveError to be thrown');
      } catch (error) {
        assert.instanceOf(error, ResolveError);
        assert.include((error as ResolveError).message, 'baseURI option is required');
      }
    });

    specify('should resolve against baseURI when provided', async function () {
      const parseResult = await parseArazzo(arazzoObject);
      const result = await resolveArazzoElement(parseResult, {
        resolve: { baseURI: 'https://example.com/arazzo.json' },
      });
      const rootParseResult = result.rootRef!.value as ParseResultElement;

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.rootRef!.uri, 'https://example.com/arazzo.json');
      assert.isTrue(isArazzoSpecification1Element(rootParseResult.api));
    });
  });
});
