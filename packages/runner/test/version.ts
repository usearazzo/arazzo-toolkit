import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import version from '../src/version.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('version', function () {
  specify("should be the package's version, as the version script writes it", function () {
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    assert.strictEqual(version, pkg.version);
  });
});
