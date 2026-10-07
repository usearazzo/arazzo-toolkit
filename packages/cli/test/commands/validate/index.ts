import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(__dirname, '..', '..', '..', 'bin', 'usearazzo.mjs');
const fixtures = path.resolve(__dirname, '..', '..', 'fixtures', 'commands', 'validate');
const validYAML = path.join(fixtures, 'arazzo-full-valid.yaml');
const validJSON = path.join(fixtures, 'arazzo-full-valid.json');
const invalidYAML = path.join(fixtures, 'arazzo-full-invalid.yaml');
const invalidJSON = path.join(fixtures, 'arazzo-invalid.json');
const warningsYAML = path.join(fixtures, 'arazzo-warnings.yaml');
const schemaInvalidYAML = path.join(fixtures, 'arazzo-schema-invalid.yaml');

// force NO_COLOR so the stylish formatter's chalk output is deterministic. CI
// sets FORCE_COLOR, which overrides NO_COLOR (and makes Node warn on stderr), so
// both inherited color variables are dropped first.
const baseEnv = { ...process.env };
delete baseEnv.FORCE_COLOR;
delete baseEnv.NO_COLOR;
const env = { ...baseEnv, NO_COLOR: '1' };

// every run gets an empty working directory by default, so a configuration file
// lying around in the package directory can never leak into a test
let emptyCwd: string;

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const run = (args: string[], cwd = emptyCwd): Promise<{ stdout: string; stderr: string }> => {
  return execFileAsync('node', [bin, 'validate', ...args], { env, cwd });
};

const runExpectFailure = async (args: string[], cwd = emptyCwd): Promise<RunResult> => {
  try {
    await execFileAsync('node', [bin, 'validate', ...args], { env, cwd });
  } catch (error: unknown) {
    const e = error as RunResult;
    return { stdout: e.stdout, stderr: e.stderr, code: e.code };
  }
  throw new Error('Expected command to fail');
};

const withTmpDir = async (body: (dir: string) => Promise<void>): Promise<void> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usearazzo-'));
  try {
    await body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const codes = (stdout: string): Array<string | number> =>
  JSON.parse(stdout).map((diagnostic: { code?: string | number }) => diagnostic.code);

describe('usearazzo validate', function () {
  before(function () {
    emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'usearazzo-cwd-'));
  });

  after(function () {
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  });

  describe('valid documents', function () {
    it('should report no problems for a valid YAML document', async function () {
      const { stdout } = await run([validYAML]);
      expect(stdout).to.equal('No problems found\n');
    });

    it('should report no problems for a valid JSON document', async function () {
      const { stdout } = await run([validJSON]);
      expect(stdout).to.equal('No problems found\n');
    });

    it('should write nothing to stderr for a valid document', async function () {
      const { stderr } = await run([validYAML]);
      expect(stderr).to.equal('');
    });
  });

  describe('invalid documents', function () {
    it('should fail with diagnostics for an invalid YAML document', async function () {
      const { stdout, code } = await runExpectFailure([invalidYAML]);
      expect(code).to.equal(1);
      expect(stdout).to.include("should always have a 'title'");
    });

    it('should fail with diagnostics for an invalid JSON document', async function () {
      const { stdout, code } = await runExpectFailure([invalidJSON]);
      expect(code).to.equal(1);
      expect(stdout).to.include("should always have a 'title'");
    });

    it('should report the file and a 1-based line:column location', async function () {
      const { stdout } = await runExpectFailure([invalidYAML]);
      const lines = stdout.split('\n');
      expect(lines[0]).to.equal(invalidYAML);
      expect(lines[1]).to.match(/^ {2}2:1-2:5\s+error\s+9010200\s+should always have a 'title'$/);
    });

    it('should align the severity column across severities', async function () {
      const { stdout } = await runExpectFailure([invalidYAML]);
      const rows = stdout.split('\n').filter((line) => /^ {2}\d/.test(line));
      const codeColumns = new Set(rows.map((row) => row.search(/\d{5,}/)));
      expect(codeColumns.size).to.equal(1);
    });

    it('should reject a document that is not an Arazzo document', async function () {
      const { stdout, code } = await runExpectFailure([
        path.join(fixtures, 'petstore.openapi.json'),
      ]);
      expect(code).to.equal(1);
      expect(stdout).to.include('not recognized as an Arazzo Specification');
    });
  });

  describe('--format option', function () {
    it('should default to the stylish formatter', async function () {
      const { stdout } = await runExpectFailure([invalidYAML]);
      expect(stdout).to.match(/✖ 21 problems \(20 errors, 1 warning\)/);
    });

    it('should render diagnostics as JSON with --format json', async function () {
      const { stdout } = await runExpectFailure([invalidYAML, '--format', 'json']);
      const diagnostics = JSON.parse(stdout);
      expect(diagnostics).to.be.an('array').with.lengthOf(21);
      expect(diagnostics[0]).to.include.keys('message', 'range', 'severity', 'code');
    });

    it('should emit an empty JSON array for a valid document', async function () {
      const { stdout } = await run([validYAML, '--format', 'json']);
      expect(JSON.parse(stdout)).to.deep.equal([]);
    });

    it('should treat --json as shorthand for --format json', async function () {
      const { stdout } = await runExpectFailure([invalidYAML, '--json']);
      expect(JSON.parse(stdout)).to.be.an('array').that.is.not.empty;
    });

    it('should let --json win over --format', async function () {
      const { stdout } = await runExpectFailure([invalidYAML, '--format', 'stylish', '--json']);
      expect(() => JSON.parse(stdout)).to.not.throw();
    });

    it('should reject an unknown format', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '--format', 'bogus']);
      expect(code).to.equal(1);
      expect(stderr).to.include('Allowed choices are stylish, json');
    });
  });

  describe('--output option', function () {
    it('should write the report to a file instead of stdout', async function () {
      await withTmpDir(async (dir) => {
        const outFile = path.join(dir, 'report.txt');
        const { stdout } = await run([validYAML, '-o', outFile]);
        expect(stdout).to.equal('');
        expect(fs.readFileSync(outFile, 'utf-8')).to.equal('No problems found\n');
      });
    });

    it('should write JSON diagnostics to a file without affecting the exit code', async function () {
      await withTmpDir(async (dir) => {
        const outFile = path.join(dir, 'report.json');
        const { stdout, code } = await runExpectFailure([invalidYAML, '--json', '-o', outFile]);
        expect(code).to.equal(1);
        expect(stdout).to.equal('');
        expect(JSON.parse(fs.readFileSync(outFile, 'utf-8'))).to.have.lengthOf(21);
      });
    });

    it('should fail when the output file cannot be written', async function () {
      await withTmpDir(async (dir) => {
        const badPath = path.join(dir, 'missing', 'out.json');
        const { stderr, code } = await runExpectFailure([validYAML, '-o', badPath]);
        expect(code).to.equal(1);
        expect(stderr).to.include(`Error: failed to write ${badPath}`);
      });
    });

    it('should refuse to overwrite the input document and leave it untouched', async function () {
      await withTmpDir(async (dir) => {
        const input = path.join(dir, 'arazzo.yaml');
        const original = fs.readFileSync(warningsYAML, 'utf-8');
        fs.writeFileSync(input, original, 'utf-8');
        const { stderr, code } = await runExpectFailure([input, '-o', input]);
        expect(code).to.equal(1);
        expect(stderr).to.include('must differ from the input file');
        expect(fs.readFileSync(input, 'utf-8')).to.equal(original);
      });
    });

    it('should refuse to overwrite the input via a symlink alias', async function () {
      await withTmpDir(async (dir) => {
        const input = path.join(dir, 'arazzo.yaml');
        const link = path.join(dir, 'link.yaml');
        const original = fs.readFileSync(warningsYAML, 'utf-8');
        fs.writeFileSync(input, original, 'utf-8');
        fs.symlinkSync(input, link);
        const { stderr, code } = await runExpectFailure([input, '-o', link]);
        expect(code).to.equal(1);
        expect(stderr).to.include('must differ from the input file');
        expect(fs.readFileSync(input, 'utf-8')).to.equal(original);
      });
    });

    it('should never write ANSI color codes to a file, even under FORCE_COLOR', async function () {
      await withTmpDir(async (dir) => {
        const outFile = path.join(dir, 'report.txt');
        // non-zero exit expected: the document has errors
        await execFileAsync('node', [bin, 'validate', invalidYAML, '-o', outFile], {
          env: { ...baseEnv, FORCE_COLOR: '1' },
          cwd: emptyCwd,
        }).catch((error: unknown) => error);
        const content = fs.readFileSync(outFile, 'utf-8');
        expect(content).to.not.include(String.fromCharCode(27));
        expect(content).to.include("should always have a 'title'");
      });
    });
  });

  describe('--json-schema-validation option', function () {
    it('should not run JSON Schema validation by default', async function () {
      const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json']);
      expect(codes(stdout)).to.not.include('json-schema');
    });

    it('should run JSON Schema validation when enabled', async function () {
      const { stdout } = await runExpectFailure([
        schemaInvalidYAML,
        '--json-schema-validation',
        '--json',
      ]);
      expect(codes(stdout)).to.include('json-schema');
    });
  });

  describe('--max-problems option', function () {
    it('should cap the number of reported diagnostics', async function () {
      const { stdout } = await runExpectFailure([invalidYAML, '--max-problems', '1', '--json']);
      expect(JSON.parse(stdout)).to.have.lengthOf(1);
    });

    it('should note the cap in the stylish output', async function () {
      const { stdout } = await runExpectFailure([invalidYAML, '--max-problems', '2']);
      expect(stdout).to.include('(showing 2 of 21 problems)');
    });

    it('should still exit non-zero when the cap hides every error', async function () {
      // the first diagnostic in sort order is a hint; the only error comes after it
      const { stdout, code } = await runExpectFailure([
        schemaInvalidYAML,
        '--max-problems',
        '1',
        '--json',
      ]);
      expect(JSON.parse(stdout).map((d: { severity: number }) => d.severity)).to.deep.equal([4]);
      expect(code).to.equal(1);
    });

    it('should reject a value with trailing characters', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '--max-problems', '1abc']);
      expect(code).to.equal(1);
      expect(stderr).to.include('must be a positive integer');
    });

    it('should reject a non-numeric value', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '--max-problems', 'abc']);
      expect(code).to.equal(1);
      expect(stderr).to.include('must be a positive integer');
    });
  });

  describe('--fail-severity option', function () {
    it('should exit 0 for a document with only warnings by default', async function () {
      const { stdout } = await run([warningsYAML]);
      expect(stdout).to.include('⚠ 5 problems (3 warnings, 2 hints)');
    });

    it('should exit non-zero for warnings with --fail-severity warning', async function () {
      const { code } = await runExpectFailure([warningsYAML, '--fail-severity', 'warning']);
      expect(code).to.equal(1);
    });

    it('should exit non-zero for hints with --fail-severity hint', async function () {
      const { code } = await runExpectFailure([warningsYAML, '--fail-severity', 'hint']);
      expect(code).to.equal(1);
    });

    it('should reject an unknown severity', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '--fail-severity', 'bogus']);
      expect(code).to.equal(1);
      expect(stderr).to.include('Allowed choices are error, warning, info, hint');
    });
  });

  describe('configuration file', function () {
    const schemaValidationConfig = {
      languageService: { validationContext: { jsonSchemaValidation: true } },
    };

    it('should pick up .usearazzo.yaml from the working directory', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(
          path.join(dir, '.usearazzo.yaml'),
          'languageService:\n  validationContext:\n    jsonSchemaValidation: true\n',
        );
        const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json'], dir);
        expect(codes(stdout)).to.include('json-schema');
      });
    });

    it('should pick up .usearazzo.json from the working directory', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.json'), JSON.stringify(schemaValidationConfig));
        const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json'], dir);
        expect(codes(stdout)).to.include('json-schema');
      });
    });

    it('should pick up a configuration file without the leading dot', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'usearazzo.yml'), JSON.stringify(schemaValidationConfig));
        const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json'], dir);
        expect(codes(stdout)).to.include('json-schema');
      });
    });

    it('should prefer .usearazzo.yaml over the other file names', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.yaml'), '{}');
        fs.writeFileSync(path.join(dir, '.usearazzo.json'), JSON.stringify(schemaValidationConfig));
        const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json'], dir);
        expect(codes(stdout)).to.not.include('json-schema');
      });
    });

    it('should not search parent directories', async function () {
      await withTmpDir(async (dir) => {
        const child = path.join(dir, 'child');
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(dir, '.usearazzo.json'), JSON.stringify(schemaValidationConfig));
        const { stdout } = await runExpectFailure([schemaInvalidYAML, '--json'], child);
        expect(codes(stdout)).to.not.include('json-schema');
      });
    });

    it('should load the file given by --config, relative to the working directory', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, 'custom.json'), JSON.stringify(schemaValidationConfig));
        const { stdout } = await runExpectFailure(
          [schemaInvalidYAML, '--config', 'custom.json', '--json'],
          dir,
        );
        expect(codes(stdout)).to.include('json-schema');
      });
    });

    it('should let --config win over a discovered configuration file', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.json'), JSON.stringify(schemaValidationConfig));
        fs.writeFileSync(path.join(dir, 'empty.yaml'), '');
        const { stdout } = await runExpectFailure(
          [schemaInvalidYAML, '-c', 'empty.yaml', '--json'],
          dir,
        );
        expect(codes(stdout)).to.not.include('json-schema');
      });
    });

    it('should pass the language service context through to the validator', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(
          path.join(dir, '.usearazzo.yaml'),
          'languageService:\n  validationContext:\n    semanticValidation: false\n',
        );
        const { stdout } = await run([invalidYAML], dir);
        expect(stdout).to.equal('No problems found\n');
      });
    });

    it('should let --json-schema-validation override the configuration file', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(
          path.join(dir, '.usearazzo.yaml'),
          'languageService:\n  validationContext:\n    jsonSchemaValidation: false\n',
        );
        const { stdout } = await runExpectFailure(
          [schemaInvalidYAML, '--json-schema-validation', '--json'],
          dir,
        );
        expect(codes(stdout)).to.include('json-schema');
      });
    });

    it('should fail when the file given by --config does not exist', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '-c', 'missing.yaml']);
      expect(code).to.equal(1);
      expect(stderr).to.include('Error: failed to load configuration file');
      expect(stderr).to.include('missing.yaml');
    });

    it('should fail for a configuration file that is not valid YAML', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.yaml'), 'languageService: [\n');
        const { stderr, code } = await runExpectFailure([validYAML], dir);
        expect(code).to.equal(1);
        expect(stderr).to.include('Error: failed to load configuration file');
      });
    });

    it('should fail for a configuration file that is not a mapping', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.yaml'), '- languageService\n');
        const { stderr, code } = await runExpectFailure([validYAML], dir);
        expect(code).to.equal(1);
        expect(stderr).to.include('expected a mapping');
      });
    });

    it('should fail when languageService is not a mapping', async function () {
      await withTmpDir(async (dir) => {
        fs.writeFileSync(path.join(dir, '.usearazzo.yaml'), 'languageService: true\n');
        const { stderr, code } = await runExpectFailure([validYAML], dir);
        expect(code).to.equal(1);
        expect(stderr).to.include("'languageService' must be a mapping");
      });
    });
  });

  describe('large output', function () {
    it('should emit complete, parseable JSON well beyond the pipe buffer size', async function () {
      await withTmpDir(async (dir) => {
        // every workflow lacks a workflowId and steps, producing several diagnostics each
        const workflows = Array.from(
          { length: 300 },
          (_, i) => `  - summary: workflow ${i}\n    description: workflow ${i}\n`,
        ).join('');
        const input = path.join(dir, 'many.arazzo.yaml');
        fs.writeFileSync(
          input,
          `arazzo: 1.0.1\ninfo:\n  title: Many\n  version: 1.0.0\nsourceDescriptions:\n  - name: api\n    url: https://example.com/openapi.json\n    type: openapi\nworkflows:\n${workflows}`,
        );
        // keep the test offline: the source description URL is never fetched
        const config = path.join(dir, 'offline.yaml');
        fs.writeFileSync(
          config,
          'languageService:\n  parseContext:\n    arazzo:\n      sourceDescriptionsResolution: false\n',
        );
        const { stdout } = await runExpectFailure([input, '--json', '-c', config]);
        expect(stdout.length).to.be.greaterThan(65536);
        expect(JSON.parse(stdout)).to.be.an('array').with.length.greaterThan(300);
      });
    });
  });

  describe('input URIs', function () {
    // serve the fixtures directory on an ephemeral loopback port for the duration
    // of `body`, always closing the server afterward (even if the assertion throws)
    const withServer = async (
      handler: http.RequestListener,
      body: (baseURL: string) => Promise<void>,
    ): Promise<void> => {
      const server = http.createServer(handler);
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      try {
        const { port } = server.address() as AddressInfo;
        await body(`http://127.0.0.1:${port}`);
      } finally {
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    };

    const serveFixtures: http.RequestListener = (req, res) => {
      const filePath = path.join(fixtures, new URL(req.url ?? '/', 'http://x').pathname);
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200);
      res.end(fs.readFileSync(filePath));
    };

    it('should accept a file:// URL', async function () {
      const { stdout } = await run([pathToFileURL(validYAML).href]);
      expect(stdout).to.equal('No problems found\n');
    });

    it('should accept a dotfile basename', async function () {
      await withTmpDir(async (dir) => {
        const dotfile = path.join(dir, '.arazzo.yaml');
        fs.copyFileSync(validYAML, dotfile);
        fs.copyFileSync(
          path.join(fixtures, 'petstore.openapi.json'),
          path.join(dir, 'petstore.openapi.json'),
        );
        const { stdout } = await run([dotfile]);
        expect(stdout).to.equal('No problems found\n');
      });
    });

    it('should resolve a relative path against the cwd', async function () {
      const cwd = path.dirname(fixtures);
      const relative = path.relative(cwd, invalidYAML);
      const { stdout, code } = await runExpectFailure([relative, '--json'], cwd);
      expect(code).to.equal(1);
      expect(JSON.parse(stdout)).to.have.lengthOf(21);
    });

    it('should fetch and validate a document over http', async function () {
      await withServer(serveFixtures, async (baseURL) => {
        const { stdout } = await run([`${baseURL}/arazzo-full-valid.yaml`]);
        expect(stdout).to.equal('No problems found\n');
      });
    });

    it('should fail with a clean error when an http URL 404s', async function () {
      await withServer(serveFixtures, async (baseURL) => {
        const { stderr, code } = await runExpectFailure([`${baseURL}/missing.yaml`]);
        expect(code).to.equal(1);
        expect(stderr).to.include('Error: Failed to read Arazzo Document');
      });
    });
  });

  describe('error handling', function () {
    it('should fail for a non-existent file and name the root cause', async function () {
      const { stderr, code } = await runExpectFailure([path.join(fixtures, 'nonexistent.yaml')]);
      expect(code).to.equal(1);
      expect(stderr).to.include('Error: Failed to read Arazzo Document');
      expect(stderr).to.include('ENOENT');
    });

    it('should fail cleanly for a file: URL with a host', async function () {
      const { stderr, code } = await runExpectFailure(['file://host/arazzo.yaml']);
      expect(code).to.equal(1);
      expect(stderr).to.match(/^Error: /);
      expect(stderr).to.not.include('    at ');
    });

    it('should reject an unknown option', async function () {
      const { stderr, code } = await runExpectFailure([validYAML, '--no-semantic-validation']);
      expect(code).to.equal(1);
      expect(stderr).to.include('unknown option');
    });
  });
});
