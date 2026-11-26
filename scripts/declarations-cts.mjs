// Writes a .d.cts beside each given .d.ts, or beside every .d.ts in each
// given directory, for consumers that require() the package. In a
// "type": "module" package TypeScript reads a .d.ts as ESM declarations,
// so the require condition needs its own CommonJS-flavored copy; relative
// imports are rewritten from .ts to .cts, so the copies import each other.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RELATIVE_TS = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\.ts\2/g;

const declarations = (target) =>
  statSync(target).isDirectory()
    ? readdirSync(target, { recursive: true })
        .map((name) => path.join(target, name))
        .filter((file) => file.endsWith('.d.ts'))
    : [target];

for (const file of process.argv.slice(2).flatMap(declarations)) {
  const source = readFileSync(file, 'utf8');
  writeFileSync(file.replace(/\.d\.ts$/, '.d.cts'), source.replace(RELATIVE_TS, '$1$2$3.cts$2'));
}
