import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { isParseResultElement } from '@speclynx/apidom-datamodel';
import { isArazzoSpecification1Element } from '@speclynx/apidom-ns-arazzo-1';
import { toValue } from '@speclynx/apidom-core';

import { bundleArazzo, BundleError } from '../../src/index.ts';
import { createHTTPServer, loadJsonFile, type ServerTerminable } from '../helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('bundleArazzo', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'bundle');

  context('given file system path to JSON file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ParseResultElement', async function () {
      const result = await bundleArazzo(rootFilePath);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain ArazzoSpecification1Element as api', async function () {
      const result = await bundleArazzo(rootFilePath);

      assert.isTrue(isArazzoSpecification1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleArazzo(rootFilePath);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
    });

    specify('should set retrievalURI metadata', async function () {
      const result = await bundleArazzo(rootFilePath);

      assert.strictEqual(result.meta.get('retrievalURI'), rootFilePath);
    });

    context('given relative file system path', function () {
      // relative to the working directory mocha runs from
      const relativePath = path.relative(process.cwd(), rootFilePath);

      for (const source of [relativePath, `./${relativePath}`]) {
        specify(`should resolve "${source}" against the working directory`, async function () {
          const result = await bundleArazzo(source);

          assert.isTrue(isArazzoSpecification1Element(result.api));
          assert.strictEqual(result.meta.get('retrievalURI'), rootFilePath);
        });
      }
    });
  });

  context('given file system path to YAML file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.yaml');

    specify('should return ParseResultElement', async function () {
      const result = await bundleArazzo(rootFilePath);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain ArazzoSpecification1Element as api', async function () {
      const result = await bundleArazzo(rootFilePath);

      assert.isTrue(isArazzoSpecification1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleArazzo(rootFilePath);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
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

    specify('should return ParseResultElement', async function () {
      const result = await bundleArazzo(`http://localhost:${server.port}/root.json`);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain ArazzoSpecification1Element as api', async function () {
      const result = await bundleArazzo(`http://localhost:${server.port}/root.json`);

      assert.isTrue(isArazzoSpecification1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleArazzo(`http://localhost:${server.port}/root.json`);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
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

    specify('should return ParseResultElement', async function () {
      const result = await bundleArazzo(`http://localhost:${server.port}/root.yaml`);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain ArazzoSpecification1Element as api', async function () {
      const result = await bundleArazzo(`http://localhost:${server.port}/root.yaml`);

      assert.isTrue(isArazzoSpecification1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleArazzo(`http://localhost:${server.port}/root.yaml`);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
    });
  });

  context('given non-Arazzo document', function () {
    const openapiFilePath = path.join(__dirname, 'fixtures', 'bundle-openapi', 'root.json');

    specify('should throw BundleError', async function () {
      try {
        await bundleArazzo(openapiFilePath);
        assert.fail('Expected BundleError to be thrown');
      } catch (error) {
        assert.instanceOf(error, BundleError);
        assert.include((error as BundleError).message, openapiFilePath);
        assert.instanceOf((error as BundleError).cause, Error);
      }
    });
  });

  context('given invalid URI', function () {
    specify('should throw BundleError', async function () {
      try {
        await bundleArazzo('/non/existent/path.json');
        assert.fail('Expected BundleError to be thrown');
      } catch (error) {
        assert.instanceOf(error, BundleError);
        assert.include((error as BundleError).message, '/non/existent/path.json');
        assert.instanceOf((error as BundleError).cause, Error);
      }
    });
  });
});
