// Writes the CommonJS declarations of the package in the working directory:
// for every entry of its package.json `exports`, the `.d.cts` its `require`
// condition names, beside the `.d.ts` its `import` condition names (the two
// must match, or the build fails). TypeScript reads a `.d.ts` in a "type": "module" package
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

// the entries of `exports`: a map of subpaths, or the conditions of "." alone
const { exports } = JSON.parse(readFileSync('package.json', 'utf8'));
const entries = Object.keys(exports).every((key) => key.startsWith('.'))
  ? Object.entries(exports)
  : [['.', exports]];

// an entry that declares types names a .d.ts for import and the matching
// .d.cts for require; one without types (a plain string such as
// "./package.json", or a null that blocks a subpath) is skipped
const declarations = entries.flatMap(([subpath, conditions]) => {
  const esm = conditions?.import?.types;
  const cjs = conditions?.require?.types;
  if (esm === undefined && cjs === undefined) return [];
  if (typeof esm !== 'string' || !esm.endsWith('.d.ts') || cjs !== esm.replace(/\.d\.ts$/, '.d.cts')) {
    throw new Error(`${subpath} must name a .d.ts for import and the matching .d.cts for require`);
  }
  return [esm];
});
if (declarations.length === 0) throw new Error('package.json exports declare no types');

for (const declaration of declarations) convert(path.resolve(declaration));
