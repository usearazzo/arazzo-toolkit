import { assert } from 'chai';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateURI, DiagnosticSeverity } from '../src/index.ts';
import { createHTTPServer } from './helpers.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, 'fixtures');

describe('validateURI', function () {
  this.timeout(10000);

  context(
    'given an absolute path to a valid Arazzo document with a relative sourceDescription',
    function () {
      specify('should return no errors', async function () {
        const filePath = path.join(__dirname, 'fixtures', 'arazzo-full-valid.yaml');
        const diagnostics = await validateURI(filePath);
        const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
        assert.lengthOf(errors, 0);
      });
    },
  );

  context('given a relative path to the same valid Arazzo document', function () {
    specify('should return no errors', async function () {
      const filePath = path.join(__dirname, 'fixtures', 'arazzo-full-valid.yaml');
      const relativePath = path.relative(process.cwd(), filePath);
      const diagnostics = await validateURI(relativePath);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });

  context('given an invalid Arazzo document', function () {
    specify('should return errors', async function () {
      const filePath = path.join(__dirname, 'fixtures', 'arazzo-full-invalid.yaml');
      const diagnostics = await validateURI(filePath);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.isAbove(errors.length, 0);
    });
  });

  context('given a dotfile-named Arazzo document', function () {
    specify('should return no errors', async function () {
      const filePath = path.join(__dirname, 'fixtures', '.dotfile-arazzo.yaml');
      const diagnostics = await validateURI(filePath);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });

  context(
    'given an HTTP URL to a valid Arazzo document with a relative sourceDescription',
    function () {
      specify('should return no errors', async function () {
        const httpServer = await createHTTPServer({ cwd: fixturesPath });
        try {
          const diagnostics = await validateURI(
            `http://localhost:${httpServer.port}/arazzo-full-valid.yaml`,
          );
          const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
          assert.lengthOf(errors, 0);
        } finally {
          await httpServer.terminate();
        }
      });
    },
  );

  context('given a file: URI to a valid Arazzo document', function () {
    specify('should return no errors', async function () {
      const filePath = path.join(fixturesPath, 'arazzo-full-valid.yaml');
      const fileURI = pathToFileURL(filePath).href;
      const diagnostics = await validateURI(fileURI);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });
});
