import { assert } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateURI, DiagnosticSeverity, ValidateError } from '../src/index.ts';
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

  context(
    'given a relative path from a working directory with URI-reserved characters',
    function () {
      specify('should return no errors', async function () {
        const cwd = process.cwd();
        // ordinary in a directory name, reserved in a URI
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arazzo#100%-'));
        for (const name of ['arazzo-full-valid.yaml', 'petstore.openapi.json']) {
          fs.copyFileSync(path.join(fixturesPath, name), path.join(tmpDir, name));
        }
        process.chdir(tmpDir);

        try {
          const diagnostics = await validateURI('arazzo-full-valid.yaml');
          const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
          assert.lengthOf(errors, 0);
        } finally {
          process.chdir(cwd);
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      });
    },
  );

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

  context('given a path to a missing document', function () {
    specify('should throw ValidateError quoting the given path', async function () {
      try {
        await validateURI('does-not-exist.arazzo.yaml');
        assert.fail('should throw ValidateError');
      } catch (error: unknown) {
        assert.instanceOf(error, ValidateError);
        assert.strictEqual(
          (error as ValidateError).message,
          'Failed to read Arazzo Document at "does-not-exist.arazzo.yaml"',
        );
        assert.isDefined((error as ValidateError).cause);
      }
    });
  });

  context('given a file: URI to a valid Arazzo document', function () {
    specify('should return no errors', async function () {
      const filePath = path.join(fixturesPath, 'arazzo-full-valid.yaml');
      const fileURI = pathToFileURL(filePath).href;
      const diagnostics = await validateURI(fileURI);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });

  context('given an Arazzo document whose Arazzo source descriptions nest', function () {
    // an Arazzo source description inside an Arazzo source description: the
    // language service froze the nested parse result twice and threw
    // (speclynx/apidom#769), so these assert that diagnostics come back at all
    specify('should return no errors for a chain', async function () {
      const filePath = path.join(fixturesPath, 'cross-document', 'chain-a.arazzo.yaml');
      const diagnostics = await validateURI(filePath);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });

    specify('should return no errors for a cycle', async function () {
      const filePath = path.join(fixturesPath, 'cross-document', 'cycle-a.arazzo.yaml');
      const diagnostics = await validateURI(filePath);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });

  context('given an Arazzo 1.1.0 document with an in on action parameters', function () {
    // codes of `successAction` / `failureAction` `parameters--no-in`
    const noInCodes = [9070702, 9081002];

    specify(
      'should report an inline in on a success and a failure action parameter',
      async function () {
        const filePath = path.join(fixturesPath, 'action-parameter-in.arazzo.yaml');
        const diagnostics = await validateURI(filePath);
        const noIn = diagnostics.filter((d) => noInCodes.includes(d.code as number));
        assert.sameMembers(
          noIn.map((d) => d.code),
          noInCodes,
        );
        assert.isTrue(noIn.every((d) => d.severity === DiagnosticSeverity.Error));
      },
    );

    specify(
      'should not report a $components.parameters reference whose component has an in',
      async function () {
        const filePath = path.join(fixturesPath, 'action-parameter-in.arazzo.yaml');
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        const referenceLine = lines.findIndex((line) =>
          line.includes('- reference: $components.parameters.sharedStatus'),
        );
        const diagnostics = await validateURI(filePath);
        const onReference = diagnostics.filter(
          (d) =>
            noInCodes.includes(d.code as number) &&
            d.range.start.line >= referenceLine - 4 &&
            d.range.start.line <= referenceLine,
        );
        assert.notEqual(referenceLine, -1);
        assert.lengthOf(onReference, 0);
      },
    );
  });
});
