// Writes the CommonJS declarations of the package in the working directory:
// for every `require` condition in its package.json `exports`, the `.d.cts`
// its `types` names. TypeScript reads a `.d.ts` in a "type": "module" package
// as ESM declarations, so `require` needs a `.d.cts`: a copy of the `.d.ts`
// beside it, whose relative specifiers are rewritten to the `.d.cts` copies
// and followed, so every file an entry point reaches gets its copy too.
// Every quoted relative specifier must end in `.ts` (or `.d.ts`), whatever
// form it appears in, or the build fails: one left unrewritten would lead a
// CommonJS consumer back to the ESM declarations.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// a quoted relative specifier, e.g. './LoggingObserver.ts'
const RELATIVE = /(['"])(\.\.?\/[^'"\n]*)\1/g;

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
  const source = readFileSync(declaration, 'utf8').replace(RELATIVE, (_, quote, specifier) => {
    const match = /^(.*?)(\.d)?\.ts$/.exec(specifier);
    if (match === null) {
      throw new Error(`${declaration}: relative specifier "${specifier}" must end in .ts`);
    }
    const [, stem, d = ''] = match;
    convert(path.join(directory, `${stem}.d.ts`));
    return `${quote}${stem}${d}.cts${quote}`;
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
