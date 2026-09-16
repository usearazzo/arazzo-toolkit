import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { isParseResultElement } from '@speclynx/apidom-datamodel';
import { isOpenApi3_1Element } from '@speclynx/apidom-ns-openapi-3-1';
import { toValue } from '@speclynx/apidom-core';

import { bundleOpenAPI, BundleError } from '../../src/index.ts';
import { createHTTPServer, loadJsonFile, type ServerTerminable } from '../helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('bundleOpenAPI', function () {
  const fixturesPath = path.join(__dirname, 'fixtures', 'bundle-openapi');

  context('given file system path to JSON file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.json');

    specify('should return ParseResultElement', async function () {
      const result = await bundleOpenAPI(rootFilePath);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain OpenApi3_1Element as api', async function () {
      const result = await bundleOpenAPI(rootFilePath);

      assert.isTrue(isOpenApi3_1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleOpenAPI(rootFilePath);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
    });

    specify('should set retrievalURI metadata', async function () {
      const result = await bundleOpenAPI(rootFilePath);

      assert.strictEqual(result.meta.get('retrievalURI'), rootFilePath);
    });

    context('given relative file system path', function () {
      // relative to the working directory mocha runs from
      const relativePath = path.relative(process.cwd(), rootFilePath);

      for (const source of [relativePath, `./${relativePath}`]) {
        specify(`should resolve "${source}" against the working directory`, async function () {
          const result = await bundleOpenAPI(source);

          assert.isTrue(isOpenApi3_1Element(result.api));
          assert.strictEqual(result.meta.get('retrievalURI'), rootFilePath);
        });
      }
    });
  });

  context('given file system path to YAML file', function () {
    const rootFilePath = path.join(fixturesPath, 'root.yaml');

    specify('should return ParseResultElement', async function () {
      const result = await bundleOpenAPI(rootFilePath);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain OpenApi3_1Element as api', async function () {
      const result = await bundleOpenAPI(rootFilePath);

      assert.isTrue(isOpenApi3_1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleOpenAPI(rootFilePath);
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
      const result = await bundleOpenAPI(`http://localhost:${server.port}/root.json`);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain OpenApi3_1Element as api', async function () {
      const result = await bundleOpenAPI(`http://localhost:${server.port}/root.json`);

      assert.isTrue(isOpenApi3_1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleOpenAPI(`http://localhost:${server.port}/root.json`);
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
      const result = await bundleOpenAPI(`http://localhost:${server.port}/root.yaml`);

      assert.isTrue(isParseResultElement(result));
    });

    specify('should contain OpenApi3_1Element as api', async function () {
      const result = await bundleOpenAPI(`http://localhost:${server.port}/root.yaml`);

      assert.isTrue(isOpenApi3_1Element(result.api));
    });

    specify('should bundle external references', async function () {
      const actual = await bundleOpenAPI(`http://localhost:${server.port}/root.yaml`);
      const expected = loadJsonFile(path.join(fixturesPath, 'bundled.json'));

      assert.deepEqual(toValue(actual), expected);
    });
  });

  context('given non-OpenAPI document', function () {
    const arazzoFilePath = path.join(__dirname, 'fixtures', 'bundle', 'root.json');

    specify('should throw BundleError', async function () {
      try {
        await bundleOpenAPI(arazzoFilePath);
        assert.fail('Expected BundleError to be thrown');
      } catch (error) {
        assert.instanceOf(error, BundleError);
        assert.include((error as BundleError).message, arazzoFilePath);
        assert.instanceOf((error as BundleError).cause, Error);
      }
    });
  });

  context('given invalid URI', function () {
    specify('should throw BundleError', async function () {
      try {
        await bundleOpenAPI('/non/existent/path.json');
        assert.fail('Expected BundleError to be thrown');
      } catch (error) {
        assert.instanceOf(error, BundleError);
        assert.include((error as BundleError).message, '/non/existent/path.json');
        assert.instanceOf((error as BundleError).cause, Error);
      }
    });
  });
});
