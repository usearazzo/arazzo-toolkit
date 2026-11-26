// Writes the CommonJS declarations of the package in the working directory:
// for every `require` condition in its package.json `exports`, the `.d.cts`
// its `types` names. TypeScript reads a `.d.ts` in a "type": "module" package
// as ESM declarations, so `require` needs a `.d.cts`: a copy of the `.d.ts`
// beside it, whose relative imports are rewritten to the `.d.cts` copies and
// followed, so every file an entry point reaches gets its copy too. A
// relative import in a form it cannot rewrite fails the build.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// a relative specifier of an import, an export, an import() type or a
// triple-slash reference
const RELATIVE = /((?:from|import)\s*\(?\s*|\/\/\/\s*<reference\s+path\s*=\s*)(['"])(\.\.?\/[^'"]+)\2/g;

const requireTypes = (conditions) => {
  if (typeof conditions !== 'object' || conditions === null) return [];
  return Object.entries(conditions).flatMap(([name, value]) =>
    name === 'require' && typeof value === 'object' && typeof value.types === 'string'
      ? [value.types]
      : requireTypes(value),
  );
};

const written = new Set();

const convert = (declaration) => {
  if (written.has(declaration)) return;
  written.add(declaration);
  const directory = path.dirname(declaration);
  const source = readFileSync(declaration, 'utf8').replace(RELATIVE, (_, lead, quote, specifier) => {
    const match = /^(.*?)(\.d)?\.ts$/.exec(specifier);
    if (match === null) {
      throw new Error(`${declaration}: cannot rewrite the relative import "${specifier}"`);
    }
    const [, stem, d = ''] = match;
    convert(path.join(directory, `${stem}.d.ts`));
    return `${lead}${quote}${stem}${d}.cts${quote}`;
  });
  writeFileSync(declaration.replace(/\.d\.ts$/, '.d.cts'), source);
};

const { exports } = JSON.parse(readFileSync('package.json', 'utf8'));
const targets = requireTypes(exports);
if (targets.length === 0) throw new Error('package.json exports name no require types');

for (const target of targets) {
  if (!target.endsWith('.d.cts')) throw new Error(`require types "${target}" is not a .d.cts`);
  convert(target.replace(/\.d\.cts$/, '.d.ts'));
}
