import { expect } from 'chai';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(__dirname, '..', 'bin', 'usearazzo.mjs');
const { version } = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf-8'),
);

describe('usearazzo', function () {
  it('should print the package version with --version', async function () {
    const { stdout } = await execFileAsync('node', [bin, '--version']);
    expect(stdout).to.equal(`${version}\n`);
  });

  it('should list the validate command in --help', async function () {
    const { stdout } = await execFileAsync('node', [bin, '--help']);
    expect(stdout).to.include('Usage: usearazzo');
    expect(stdout).to.match(/validate \[options\] <uri>/);
  });
});
