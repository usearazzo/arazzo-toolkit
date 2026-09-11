---
paths:
  - "package.json"
  - "packages/*/package.json"
  - "babel.config.cjs"
  - "lerna.json"
---

When a change touches the root `package.json`, any `packages/*/package.json`, `babel.config.cjs` or `lerna.json`, and either **adds a library, removes a library, or changes its role in the architecture**, update `specs/tech-stack.md` in the same commit.

Version bumps do NOT require a constitution update — `package.json` and `package-lock.json` are the version source of truth. Do not re-add version numbers to `specs/tech-stack.md`.

The bar for "belongs in `specs/tech-stack.md`" is: **would swapping this out force an architectural change?**

- **Yes (load-bearing, list in tech-stack.md):** `@speclynx/apidom-*` (the data model every package produces and consumes — datamodel, core, namespaces, parser adapters, reference, traverse, ls), `@swaggerexpert/arazzo-runtime-expression` + `@swaggerexpert/arazzo-criterion` (the Arazzo grammars the parser wraps and the runner evaluates), `swagger-client` (vendored request builder behind the runner's `OpenAPIOperationExecutor`), `vscode-languageserver-types` (the validator's `Diagnostic` contract), `lerna` + npm workspaces (fixed-version monorepo orchestration), `typescript` + `@microsoft/api-extractor` (the `@public` declaration contract), Babel 8 (emits `.mjs` / `.cjs` from `.ts`; `tsc` only type-checks), `webpack` (UMD browser bundles and the swagger-client vendor bundle), `mocha` + `chai` + `mocha-chai-jest-snapshot` (snapshot-driven test contract), ESLint 10 flat config + `typescript-eslint` + `eslint-plugin-import-x` + `eslint-plugin-mocha` + `eslint-plugin-prettier`, `prettier`, `husky` + `lint-staged` + `@commitlint/cli` + `@commitlint/config-conventional` (commit-hook pipeline).
- **No (swappable implementation detail, do NOT list):** `@types/*` packages, `ramda` / `ramda-adjunct` helpers, `rimraf` / `copyfiles` / `shx` / `cross-env` / `npm-run-all` script glue, `dedent`, `sinon`, `jsdom`, `core-js`, `@swaggerexpert/jsonpath` / `@swaggerexpert/json-pointer` unless a phase makes them a public contract.

If in doubt, ask the same question again: would replacing it with an equivalent competitor change the shape of the system? If no, leave it out of the constitution. The "What We Are Not Using" and "Roadmap, not yet built" sections of `specs/tech-stack.md` are equally important — when removing a load-bearing library or marking a planned one as shipped, update those sections too.
