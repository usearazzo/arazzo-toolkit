// Writes the CommonJS declarations of the package in the working directory:
// for every `require` condition in its package.json `exports`, the `.d.cts`
// its `types` names. TypeScript reads a `.d.ts` in a "type": "module" package
// as ESM declarations, so `require` needs a `.d.cts`: a copy of the `.d.ts`
// beside it, whose relative imports are rewritten to the `.d.cts` copies and
// followed, so every file an entry point reaches gets its copy too. Imports
// of other packages by name are left alone: each package's own `require`
// condition resolves them.
//
// Imports are read with TypeScript's own scanner, not a regex, so paths in
// comments (TSDoc examples) are ignored. Anything a copy cannot represent (a
// relative import not ending in `.ts`, one that resolves to nothing, a
// triple-slash reference path) fails the build rather than leaving a `.d.cts`
// that reaches ESM declarations.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// every `types` under a `require` condition, however deeply nested
const requireTypes = (conditions, required = false) => {
  if (typeof conditions !== 'object' || conditions === null) return [];
  return Object.entries(conditions).flatMap(([name, value]) =>
    required && name === 'types' && typeof value === 'string'
      ? [value]
      : requireTypes(value, required || name === 'require'),
  );
};

const isRelative = (specifier) =>
  specifier === '.' || specifier === '..' || /^\.\.?\//.test(specifier);

const written = new Set();

const convert = (declaration) => {
  if (written.has(declaration)) return;
  written.add(declaration);
  const source = readFileSync(declaration, 'utf8');
  const { importedFiles, referencedFiles } = ts.preProcessFile(source, true, true);

  for (const { fileName } of referencedFiles) {
    throw new Error(`${declaration}: /// <reference path="${fileName}"> cannot be copied to a .d.cts`);
  }

  // rewrite from the end, so earlier positions stay valid; pos is the
  // specifier's opening quote
  let rewritten = source;
  for (const { fileName, pos } of [...importedFiles].sort((a, b) => b.pos - a.pos)) {
    if (!isRelative(fileName)) continue;
    if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) {
      throw new Error(`${declaration}: relative import "${fileName}" must end in .ts`);
    }
    const target = path.resolve(path.dirname(declaration), fileName.replace(/\.ts$/, '.d.ts'));
    if (!existsSync(target)) {
      throw new Error(`${declaration}: relative import "${fileName}" resolves to nothing`);
    }
    convert(target);
    const start = pos + 1;
    rewritten = `${rewritten.slice(0, start)}${fileName.replace(/\.ts$/, '.cts')}${rewritten.slice(start + fileName.length)}`;
  }

  writeFileSync(declaration.replace(/\.d\.ts$/, '.d.cts'), rewritten);
};

const { exports } = JSON.parse(readFileSync('package.json', 'utf8'));
const targets = requireTypes(exports);
if (targets.length === 0) throw new Error('package.json exports name no require types');

for (const target of targets) {
  if (!target.endsWith('.d.cts')) throw new Error(`require types "${target}" is not a .d.cts`);
  convert(path.resolve(target.replace(/\.d\.cts$/, '.d.ts')));
}
