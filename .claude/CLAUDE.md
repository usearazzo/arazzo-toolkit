# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arazzo Toolkit is a TypeScript monorepo of packages for **parsing**, **resolving**, **validating** and **running** [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) documents (Arazzo 1.0.0, 1.0.1, 1.1.0) together with the OpenAPI source descriptions they reference (OpenAPI 2.0, 3.0.x, 3.1.x). Every package is built on [SpecLynx ApiDOM](https://github.com/speclynx/apidom) as the underlying data model — documents are parsed into ApiDOM `ParseResultElement` trees and stay ApiDOM elements throughout.

## Architecture

### Packages

The monorepo contains 4 packages under `packages/`, published under the `@usearazzo` npm scope:

1. **`parser`** (`@usearazzo/parser`) — parses Arazzo and OpenAPI documents from a file path, URL, string or object into ApiDOM. Entry points: `parseArazzo`, `parseOpenAPI`, plus `parseRuntimeExpression` and `parseCriterionCondition` (thin wrappers over `@swaggerexpert/arazzo-runtime-expression` / `@swaggerexpert/arazzo-criterion`). Throws `ParseError`. Ships an in-memory resolver so object/string input can still resolve relative source description URLs against `resolve.baseURI`.

2. **`resolver`** (`@usearazzo/resolver`) — dereferences Arazzo and OpenAPI documents via `@speclynx/apidom-reference`. Entry points: `dereferenceArazzo`, `dereferenceOpenAPI` and their `*Element` variants. Throws `DereferenceError`.

3. **`validator`** (`@usearazzo/validator`) — validates and lints Arazzo documents via the `@speclynx/apidom-ls` language service. Entry points: `validate` (from a `TextDocument`) and `validateURI` (from a path/URL). Returns LSP `Diagnostic` objects.

4. **`runner`** (`@usearazzo/runner`) — executes Arazzo workflows against real HTTP APIs. A pipeline of single-responsibility building blocks:
   - `registry/` — `DocumentRegistry` loads and caches the entry document and its source descriptions through `DocumentRegistryProvider`s (Arazzo, OpenAPI). Providers build the indexes; documents are containers.
   - `document/` — `ArazzoDocument` / `OpenAPIDocument` hold a parse result plus prebuilt indexes (`ArazzoWorkflowIndex`, `ArazzoStepIndex`, `ArazzoSourceDescriptionIndex`, `OpenAPIOperationIndex`).
   - `extractor/` → `normalizer/` → `assembler/` — pull a workflow/step/operation out of ApiDOM, normalize it into a plain shape (version-specific normalizers for OpenAPI 2 / 3.0 / 3.1), and assemble OpenAPI documents for the vendored `swagger-client` request builder.
   - `executor/` — `WorkflowExecutor` (iterates steps, owns run state, interprets `goto`/`retry`/`end`), `StepExecutor` (one Arazzo step), `OpenAPIOperationExecutor` (one HTTP operation), plus locator normalizers, `StepRetryRunner`, `StepTransitionInterpreter`, `WorkflowCallStack` and abort support.
   - `client/` — the pluggable `HTTPClient` seam (`httpClientFetch` by default), request/response models and the response normalizer.
   - `expression/`, `criterion/`, `resolver/`, `state/` — runtime expression evaluation, criterion evaluators (simple, regex, JSONPath, XPath), parameter/request-body/output resolvers, and `WorkflowExecutionState`.
   - `vendor/swagger-client.mjs` — a webpack bundle of `swagger-client` built by `build:swagger-client` (runs as part of `build:es`); it is a build artifact, don't edit it.

Only `@usearazzo/parser` is currently published; `resolver`, `validator` and `runner` are marked private and skipped by lerna on publish.

### Key Concepts

**ApiDOM elements:** All documents are ApiDOM trees from `@speclynx/apidom-ns-arazzo-1` / `@speclynx/apidom-ns-openapi-*`. Use the namespace predicates and element classes rather than poking at raw JSON.

**Source descriptions:** An Arazzo document references OpenAPI documents (and other Arazzo documents) via `sourceDescriptions`. Relative URLs resolve against the entry document's retrieval URI, or `resolve.baseURI` for in-memory input.

**Runtime expressions & criteria:** Arazzo `$steps.foo.outputs.bar`-style expressions and step `successCriteria`/`failureCriteria` are parsed by the `@swaggerexpert/*` grammars and evaluated by the runner.

**Authoring errors vs. failed runs:** The runner distinguishes errors in the Arazzo document (thrown as typed `ArazzoRunnerError` subclasses) from steps/workflows that ran and failed (recorded in run state).

### Package Internal Structure

Each package contains:
- `src/` — TypeScript sources; Babel emits `.mjs` / `.cjs` siblings next to each `.ts` (gitignored)
- `src/index.ts` — the public entry; everything exported here must carry `@public` TSDoc so `api-extractor` includes it
- `test/` — Mocha tests with fixtures, transpiled to `.mjs` before running
- `config/` — webpack (UMD browser bundle) and `api-extractor` configs
- `types/`, `dist/` — generated declarations and browser bundle (gitignored)

## Dependencies

Key libraries:
- `@speclynx/apidom-*` — ApiDOM data model, namespaces, parser adapters, reference resolution, language service
- `@swaggerexpert/arazzo-runtime-expression`, `@swaggerexpert/arazzo-criterion`, `@swaggerexpert/jsonpath`, `@swaggerexpert/json-pointer` — Arazzo grammars and query utilities
- `swagger-client` — HTTP request building (vendored into the runner as a bundle)
- `vscode-languageserver-types` — `Diagnostic` types surfaced by the validator

## Common commands

Always `source ~/.nvm/nvm.sh && nvm use` first (see `.claude/rules/nvm.md`). All npm tooling resolves from the repo root (npm workspaces); per-package scripts run from `packages/<pkg>`.

| Task | Command |
|---|---|
| Install deps | `npm install` (run from repo root) |
| Build all packages (declarations + ES + CJS + UMD) | `npm run build` |
| Build all packages, ES modules only (fast, what CI tests against) | `npm run build:es` |
| Build one package, ES only | `cd packages/<pkg> && npm run build:es` |
| Clean all build output | `npm run clean` |
| Run all tests | `npm test` (delegates via `lerna run test`) |
| Run one package's tests | `cd packages/<pkg> && npm test` |
| Run a test subset | `cd packages/<pkg> && npm test -- --grep "<describe title>"` |
| Update snapshots | `cd packages/<pkg> && UPDATE_SNAPSHOT=1 npm test` |
| Lint check (all packages) | `npm run lint` |
| Lint fix (all packages) | `npm run lint:fix` (Prettier runs via `eslint-plugin-prettier`) |
| Type-check (all packages) | `npm run typescript:check-types` |
| Generate declarations + api-extractor report | `npm run typescript:declaration` |
| Link packages globally for local consumers | `npm run link` / `npm run unlink` |

Set `CPU_CORES` to your core count for faster parallel builds (`.env` holds `CPU_CORES=2` but npm does not load it).

## Lint and commit hooks at the npm root

ESLint (`eslint.config.js` — flat config), Prettier (`.prettierrc`), commitlint (`.commitlintrc.json`) and lint-staged (`.lintstagedrc`) all live at the repo root. The husky hook scripts are tracked under `.husky/`:

- `.husky/pre-commit` → `npx lint-staged` runs `eslint` (no `--fix`) on staged `*.ts`.
- `.husky/commit-msg` → `npx commitlint -e` validates the commit message against `@commitlint/config-conventional` plus the project's `header-max-length: 69` and `scope-case` rules.

The root `prepare` script (`husky`) wires them on `npm install` by pointing `core.hooksPath` at `.husky/_`. CI (`lint-commit-messages` job) re-validates every PR commit regardless.

The `.claude/hooks/commitlint-before-commit.mjs` PreToolUse hook (which guards Claude-driven commits) and `.husky/commit-msg` (which guards human-driven commits) share the same `.commitlintrc.json` config, so they enforce the same rules.

## Harness layout (`.claude/`)

- **`specs/`** (repo root, not under `.claude/`) — the SDD constitution: `specs/mission.md`, `specs/tech-stack.md`, `specs/roadmap.md`, plus `specs/lessons.md` once `/sdd-distill-lessons` has run. Not yet bootstrapped — create it via `/sdd-create-constitution`; future phases append via `/sdd-new-phase` and materialize via `/sdd-new-spec` into `specs/YYYY-MM-DD-<slug>/`.
- **`rules/`** — always-on guidance. `git-workflow.md` (branches, atomic commits, DCO sign-off, `Refs #N` vs `Closes #N`), `conventional-commits.md` (header format, ≤69 chars, scopes), `typescript-code-style.md` (ESLint flat config, Prettier 100-col, `.ts` import suffix, `as const` over enums, `@public` TSDoc for exports), `testing.md` (Mocha + snapshots, when to run), `building.md`, `nvm.md`, `worktrees.md`, `karpathy-guidelines.md` (think before coding, simplicity, surgical changes), `readme-sync.md` (package README must follow `src/index.ts` public-surface changes), `sdd-constitution.md` (SDD workflow), `update-tech-stack-on-deps.md` (constitution updates on dependency role changes), `review-auto-apply.md` + `copilot-review-comments.md` (review behavior).
- **`hooks/`** — `commitlint-before-commit.mjs` (PreToolUse) blocks malformed `git commit -m` payloads. `typecheck-before-commit.sh` and `declarations-before-commit.sh` (PreToolUse) run `typescript:check-types` / `typescript:declaration` on the packages with staged changes and deny the commit on failure. `lint-fix-after-edit.sh` (PostToolUse) runs `eslint --fix` on every edited `.ts`/`.tsx` file. `typescript-check.sh` (PostToolUse) runs `tsc --noEmit -p <package-tsconfig>` after every `.ts` edit under `packages/`; on type errors it exits 2 with the `tsc` output on stderr so Claude Code surfaces them back into the conversation.
- **`skills/`** — invokable slash commands. SDD: `/sdd-create-constitution`, `/sdd-new-phase`, `/sdd-new-spec`, `/sdd-implement-spec`, `/sdd-distill-lessons`. Review: `/review-community` (someone else's PR with the diplomatic tone in `output-styles/review-comments.md`).
- **`templates/sdd/`** — structural scaffolds for constitution and feature-spec files. `/sdd-create-constitution` and `/sdd-new-spec` consume these.
- **`worktrees/`** — git-worktree mount points (gitignored content; only `.gitkeep` is tracked).
- **`output-styles/review-comments.md`** — diplomatic-review tone, used as a turn-instruction overlay by `/review-community`.

## Conventions

- **Branch + PR for every change.** No direct push to `main` — branch (`feat/`, `fix/`, `chore/`, `refactor/`, `test/`, `docs/`), commit there, push, open a PR via `gh pr create`. PRs are squash-merged; the squash header must follow Conventional Commits.
- **Atomic commits, DCO sign-off.** `git commit -s`. One logical change per commit. Header ≤69 chars; scope is the package short name (e.g. `fix(parser): resolve relative file paths against working directory`, `feat(runner): add workflow-level parameters`).
- **Public API is deliberate.** Everything exported from `src/index.ts` needs `@public` TSDoc for `api-extractor`, a README entry, and a typed error class where it can fail.
- **Documents stay ApiDOM.** Work with namespace element classes and predicates from `@speclynx/apidom-ns-*`; don't convert to plain JSON to poke at fields.
