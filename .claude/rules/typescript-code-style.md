---
paths:
  - "packages/*/src/**/*.ts"
  - "packages/*/test/**/*.ts"
---

## TypeScript code style

Formatting is Prettier 3 (`.prettierrc` at the repo root) wired into ESLint via `eslint-plugin-prettier/recommended`, so `npm run lint:fix` reformats *and* lints in one pass. Print width 100, single quotes, trailing commas everywhere, 2-space indent, LF line endings. The rule set lives in `eslint.config.js` (flat config) and rests on `typescript-eslint` plus `eslint-plugin-import-x` (registered under the `import/` prefix for backwards compatibility with inline disable comments) and `eslint-plugin-mocha` for test trees. Run `npm run lint:fix` inside the package(s) you touched before handing off — root `npm run lint:fix` delegates via `lerna run lint:fix`.

A PostToolUse hook (`.claude/hooks/lint-fix-after-edit.sh`) runs `eslint --fix` on every Claude-edited `.ts`/`.tsx` file and `.claude/hooks/typescript-check.sh` runs `tsc --noEmit -p <package-tsconfig>` after every `.ts` edit under `packages/` (on type errors it exits 2 so the `tsc` output comes back into the conversation). The pre-commit hooks (`.claude/hooks/typecheck-before-commit.sh`, `.claude/hooks/declarations-before-commit.sh`) run `typescript:check-types` and `typescript:declaration` on changed packages so type errors surface before a commit lands. Husky's own pre-commit (installed on `npm install` via the root `prepare` script) runs `lint-staged` (`eslint` without `--fix` on staged `.ts`), so any remaining lint error blocks the commit.

- **`'.ts'` suffix on relative TypeScript imports.** `tsconfig.json` sets `allowImportingTsExtensions: true` and `import/extensions` is `['error', 'always', { ts: 'always', tsx: 'always', js: 'always', jsx: 'never', ignorePackages: true }]`, so relative imports carry their extension while package imports (`ramda`, `@speclynx/apidom-core`) stay extension-free. Babel rewrites the source `.ts` to the emitted `.mjs`/`.cjs` at build time (`scripts/babel-plugin-add-import-extension.cjs`).

- **Single quotes for strings.** `quotes: ['error', 'single', { avoidEscape: true }]`. Use a double-quoted literal only when the string contains a single quote and escaping would be noisier.

- **Imports are grouped and separated by blank lines.** `import/order` enforces two groups: `[builtin, external, internal]` then `[parent, sibling, index]`, with `newlines-between: 'always'`. The autofixer handles ordering; just run `lint:fix`.

- **No deep relative imports across packages.** Within a package, `../foo.ts` is fine. Reaching into another workspace package via relative paths is wrong — import its public entry (e.g. `@usearazzo/parser`). `import/no-extraneous-dependencies` blocks importing devDeps from non-test code (test trees under `packages/*/test/**` are exempt).

- **`_`-prefix for intentionally unused params and vars.** `@typescript-eslint/no-unused-vars` is `error` with `argsIgnorePattern: '^_'`, `varsIgnorePattern: '^_'`, `caughtErrorsIgnorePattern: '^_'`. Use `_result`, `_err` for "I have to declare it but I don't use it" cases. Don't disable the rule.

- **`any` is a warning, not an error — and a smell.** `@typescript-eslint/no-explicit-any: 'warn'`. Prefer `unknown` and narrow with type guards; reach for `Record<string, unknown>` for opaque object shapes.

- **`tsconfig.json` is strict on purpose.** `strict: true`, `isolatedModules: true`, `module`/`moduleResolution: nodenext`, `noEmit: true` (Babel emits; tsc only type-checks). Don't loosen these to silence errors — fix the type.

- **Modules are NodeNext ESM in source; Babel emits both flavors.** Every package has `"type": "module"`; `build:es` / `build:cjs` emit `.mjs` / `.cjs` siblings next to each `.ts`, and `package.json` `exports` maps `import` / `require` to them. Don't add CJS interop shims in source — Babel handles it.

- **Prefer `interface` for object shapes, `type` for unions / mapped / utility forms.** Existing source uses `interface Options { ... }` for record shapes and `type X = A | B` for aliases. Match that.

- **`as const` for enum-like records, never TypeScript `enum`s.** Fixed sets are `as const` objects with a derived type (`typeof X[keyof typeof X]`). `enum`s have runtime emit and are absent from the codebase; don't introduce them.

- **`import type` / `export type` for type-only symbols.** `isolatedModules: true` means Babel transpiles one file at a time and cannot tell a type re-export from a value re-export — a bare `export { Foo } from './foo.ts'` for a type-only `Foo` breaks the emitted `.mjs`. Use `export type { ... }` for re-exports and `import type` for imports that are only used in type positions.

- **Empty interfaces are allowed.** `@typescript-eslint/no-empty-object-type` is off — empty interfaces are an intentional type-extension pattern.

- **Public API needs `@public` TSDoc.** `typescript:declaration` runs `api-extractor`, which only emits symbols exported from `src/index.ts` that carry a `@public` release tag. A new export without it is dropped from the generated `types/` and the declaration build warns.

- **Mocha test rules are enforced.** `mocha/no-exclusive-tests`, `mocha/no-mocha-arrows` (use `function () {}` for `describe`/`it`), `mocha/no-identical-title`, `mocha/no-top-level-hooks` and friends are errors in `packages/*/test/**`. Test-tree variables must be camelCase/PascalCase/UPPER_CASE with no leading underscore (`__dirname`/`__filename` excepted).

- **No comments explaining what code already says.** Project-wide rule from `.claude/rules/karpathy-guidelines.md`: comments explain *why*, not *what*. Line comments (`//`) start lowercase; block comments (`/** */`) start uppercase.

When ESLint and Prettier disagree with a stylistic choice in your edit, the autofixer wins. If a rule is genuinely wrong for a specific line, prefer narrowing the rule in `eslint.config.js` over scattering inline `// eslint-disable` comments.
