---
type: constitution
section: tech-stack
generated_by: spec-driven-agent
generated_at: 2026-09-11T22:07:08Z
confidence: high
---

# Tech Stack

Arazzo Toolkit uses the following technology choices based on the current repository state and implementation evidence. Facts below are confirmed from code and configuration unless marked *inferred*.

## Architecture Summary

- **Application style:** LIBRARY — a monorepo of four npm packages, no CLI binary, no service.
- **Primary language(s):** TypeScript (sources), emitted as JavaScript by Babel.
- **Rendering model:** N/A (library).
- **Deployment/runtime shape:** ISOMORPHIC — Node.js 20.10+ and evergreen browsers. Every package ships ESM, CommonJS, and a UMD browser bundle. The isomorphic contract is load-bearing: the validator canonicalizes URIs with isomorphic utilities because it is bundled for the browser, and the parser resolves relative input against the page URL there.
- **Current maturity:** EARLY_STAGE — `1.0.1-alpha.2` in Lerna fixed mode. `@usearazzo/parser` is published and `@usearazzo/resolver` is publishable (its first release is cut by hand once Phase 1 merges); `validator` and `runner` carry `"private": true` as a publish guard (the source is public; `private` only stops `lerna publish`).

## Core Stack

| Layer | Choice | Evidence / Rationale |
|---|---|---|
| Language | TypeScript 5.9, `strict`, `isolatedModules`, `module: nodenext`, `allowImportingTsExtensions` | root `tsconfig.json`; relative imports carry the `.ts` suffix |
| Runtime | Node.js `>=20.10.0` for consumers, `=26.3.1` for development | `packages/*/package.json` `engines` vs `.nvmrc` and root `engines` — a deliberate split |
| Data model | SpecLynx ApiDOM (`@speclynx/apidom-*` 5.x) | every package parses into and operates on `ParseResultElement` trees; nothing converts to plain JSON |
| Build (code) | Babel 8 (`preset-env` + `preset-typescript`, `transform-runtime` over `core-js` 3) emitting `.mjs` and `.cjs` siblings next to each `.ts` | `babel.config.cjs`; `scripts/babel-plugin-add-import-extension.cjs` rewrites relative specifiers |
| Build (types) | `tsc --emitDeclarationOnly` + `@microsoft/api-extractor` d.ts rollup | `packages/*/tsconfig.declaration.json`, root `api-extractor.json`; `tsc` never emits JavaScript |
| Build (browser) | webpack 5 UMD bundles, minified variant via Terser | `packages/*/config/webpack/browser.config.js`; served via each package's `unpkg` field |
| Monorepo | npm workspaces + Lerna 10, fixed versioning, conventional-commit changelogs | `lerna.json` (`exact: true`, `allowBranch: main`, `createRelease: github`) |

## Key Libraries and Frameworks

- **`@speclynx/apidom-*`** — datamodel, core, error, json-pointer, traverse, reference (resolution, dereferencing, bundling, file and HTTP resolvers), `ns-arazzo-1`, `ns-openapi-2 / 3-0 / 3-1`, parser adapters, and `apidom-ls` (the language service the validator delegates to). This is the engine every package shares.
- **`@swaggerexpert/arazzo-runtime-expression`, `@swaggerexpert/arazzo-criterion`** — the Arazzo grammars. The parser wraps them as pure, synchronous parsers; the runner evaluates them.
- **`@swaggerexpert/jsonpath`, `@swaggerexpert/json-pointer`, `fontoxpath` + `@xmldom/xmldom`** — criterion evaluation backends (JSONPath RFC 9535, XPath 3.1) and JSON-Pointer request-body replacements in the runner.
- **`swagger-client`** — a build-time dependency of the runner only. `config/webpack/swagger-client.config.js` bundles exactly three functions (`buildRequest`, `serializeResponse`, `idFromPathMethodLegacy`) into `src/vendor/swagger-client.mjs`, re-pointing `@swagger-api/apidom-*` to `@speclynx/apidom-*` so no second ApiDOM copy exists at runtime. The bundle is a build artifact.
- **`vscode-languageserver-types`** — the `Diagnostic` contract the validator returns.
- **`ramda` / `ramda-adjunct`** — functional helpers; swappable, not load-bearing.

## Data and Storage

- **Primary storage:** NONE — documents are read from the filesystem or HTTP(S) at call time.
- **Access pattern:** FILESYSTEM and HTTP via `@speclynx/apidom-reference` resolvers (`FileResolver` with a regex allow-list for `.json` / `.yaml` / `.yml`; `HTTPResolverAxios` with a 15 s timeout and 5 redirects). The parser adds a `MemoryResolver` for object and inline-string input, served under a synthetic `memory://` URI or the caller's `resolve.baseURI`.
- **Caching / state:** the runner's `DocumentRegistry` is an LRU of parsed documents (capacity 4, entry document pinned); `WorkflowExecutionState` is fresh per workflow invocation. Nothing persists between calls.
- **Notes:** `retrievalURI` metadata on the parse result is the load-bearing handoff between packages. In-memory input has none, so `resolve.baseURI` must be supplied downstream (see the resolver reference at `https://usearazzo.com/docs/resolver/`).

## Testing

- **Test framework(s):** Mocha 12 + Chai 6, snapshots via `mocha-chai-jest-snapshot` with ApiDOM and string serializers from `scripts/`.
- **Test types visible:** UNIT and package-level INTEGRATION against fixture documents and real parsing. Runner tests inject a stub `HTTPClient`; nothing mocks the toolkit's own layers. No browser test runner and no end-to-end suite against a live API.
- **Current testing pattern:** `npm test` per package builds `src` to `.mjs`, transpiles `test/**/*.ts` to `.mjs`, then runs Mocha over the emitted files. Coverage today: parser 74 cases, resolver 58, validator 22, runner 563 across 40 files. `UPDATE_SNAPSHOT=1 npm test` refreshes snapshots.

## Tooling and Developer Experience

- **Local development:** `nvm use`, `npm install`, then per package `npm run build:es` and `npm test`. `CPU_CORES` bounds parallel build steps. See `.claude/CLAUDE.md` § Common commands.
- **Build / release:** `lerna run build` fans out to `typescript:declaration`, `build:es`, `build:cjs`, `build:umd:browser`. Releases are cut manually via the `release.yml` `workflow_dispatch` on `main`: `lerna version prerelease --preid alpha --no-private`, GitHub release, `lerna publish from-package --no-private` with npm provenance (OIDC). Channels are alpha (today) → beta (API frozen for 1.x) → GA (all packages published, official petstore workflows green, frozen surfaces, complete website reference docs); see `specs/mission.md` § Decisions for the gate.
- **Formatting / linting:** ESLint 10 flat config (`typescript-eslint`, `eslint-plugin-import-x` under the `import/` prefix, `eslint-plugin-mocha`, Prettier via `eslint-plugin-prettier`). Prettier 3: single quotes, trailing commas, width 100, LF.
- **Type checking:** `tsc --noEmit` per package (`typescript:check-types`); api-extractor validates the `@public` surface on `typescript:declaration`.
- **CI/CD:** GitHub Actions. `build.yml` on push and PR to `main`: commit-message lint, ESLint, type check, tests, ES build, all on Node 26.3.1. `nightly-build.yml` runs the full build daily. `codeql.yml` scans JavaScript. Dependabot runs daily with auto-merge for non-major updates. Husky + lint-staged + commitlint guard local commits.

## Deployment and Operations

- **Deployment target:** npm registry (`@usearazzo` scope, public access, provenance) plus `unpkg` for the UMD bundles.
- **Environment management:** none required. The only environment variable the tooling reads is `CPU_CORES`.
- **Observability:** NONE_OBSERVED in the libraries. The runner exposes run state and a settled result per workflow; no logging or tracing hooks exist (tracked as #85).
- **Error handling / resilience:** every package throws typed errors for its layer — `ParseError`; `DereferenceError`, `ResolveError`, and `BundleError`, one per resolver operation; `ArazzoRunnerError` (with `ExecutionError`, `ClientError`, `CriterionError`, and others carrying string `reason` codes). The validator never throws for invalid documents; it returns diagnostics. Runner guards: `maxSteps` (1000, shared across the call tree), `maxWorkflowDepth` (32), cycle detection, cooperative cancellation via `AbortSignal`.

## Constraints and Conventions

- **Everything stays ApiDOM.** Work with `@speclynx/apidom-ns-*` element classes and predicates. Converting to plain JSON to poke at fields is a violation.
- **One engine, no disagreement.** The validator and runner must agree on any document they both see. A divergence is a bug against the shared ApiDOM foundation, not a per-tool interpretation.
- **Public API is deliberate.** Every export from `src/index.ts` carries `@public` TSDoc for api-extractor, a README entry, and a typed error class where it can fail. Canonical reference documentation lives in `usearazzo/website` (`_reference/parser.md` today, which matches `src/index.ts` one to one; the validator rules reference will live there too). In-repo READMEs are intentionally short and link to the website.
- **Layering is parse → resolve → validate → run.** `resolver` and `validator` depend on `parser`; `runner` depends on both. No package reaches into another via relative paths.
- **The resolver takes paths and URLs only.** `dereference*`, `resolve*`, and `bundle*` read from the file system or HTTP(S). Callers with an object or string parse first and hand the `ParseResultElement` to `dereference*Element` or `resolve*Element` with `resolve.baseURI`. Bundling has no element variant: only a whole document bundles, mirroring `@speclynx/apidom-reference`, which has no `bundleApiDOM`. The resolver does not grow a `MemoryResolver`.
- **Validator trust boundary is permissive by design.** `parseContext.fileAllowList` defaults to `['*']` and `sourceDescriptionsResolution` is on, matching the parser and `apidom-ls`. Callers validating untrusted documents opt down (`fileAllowList: []`, `sourceDescriptionsResolution: false`) per the README security section. This is a decision, not a gap.
- **Runner architecture contract** (see `packages/runner/README.md` § Architecture): providers build indexes in one traversal, documents are containers; every layer reads run state but never mutates it, `WorkflowExecutor` is the single writer; collaborators are constructor-bound and injectable, with `forDocument()`-style derivation instead of per-call parameters.
- **Authoring errors throw, failed runs resolve.** Malformed documents raise `ExecutionError` with a named `reason` before any live request; unmet `successCriteria` yield `status: 'failed'` as a normal result.
- **The `HTTPClient` seam resolves for every HTTP status** and throws only on transport failure. Non-2xx is a valid Arazzo outcome judged by criteria. Authentication is not modeled; credentials go through a request interceptor, until the Arazzo Specification itself defines a security model.
- **Referenced workflows run with empty inputs in 1.0.x.** `dependsOn`, retry `workflowId` references, and `goto` transfers receive `{}` because 1.0.x gives them no input mapping (decided in #62). Arazzo 1.1.0's action `parameters` (#115) is the input channel, implemented post-publish.
- **In-memory input needs `resolve.baseURI`.** Object and string input carry a synthetic `memory://` base; relative source descriptions resolve only when the caller supplies an absolute base. Memory resolvers are re-sorted ahead of all others so a file resolver can never shadow them.
- **Babel emits, tsc type-checks.** Do not make `tsc` emit JavaScript. Relative imports keep the `.ts` suffix; Babel rewrites them at build time.
- **Internal workspace pins track the published parser.** `resolver`, `validator`, and `runner` must depend on the parser version that is actually published; a stale exact pin is drift and is corrected in each package's publishing phase.
- **Conventional Commits, DCO, squash merges.** Header ≤ 69 characters, scope is the package short name, `git commit -s`. Branches are `<type>/<issue>-<slug>`.
- **Version-gated criterion types.** `jsonpath` accepts only `rfc9535`, `xpath` only `xpath-31`; other versions raise `CriterionError` `unsupported-version`.

## What We Are Not Using

- No **CLI binary** — the `arazzo-validator` binary was removed as a breaking change; no package declares `bin`. The root README's CLI section is a placeholder for the package proposed in #84.
- No **`ts-node` or test-time loaders** — tests run as real ESM against Babel output.
- No **mocking library in practice** — `sinon`, `jsdom`, `jsdom-global`, and `microtime` are root devDependencies with no usage in any package (*inferred*: inherited scaffolding).
- No **semantic-release** — versioning is Lerna with conventional commits, triggered by hand.
- No **authentication model** in the runner — by design, mirroring the specification.
- No **AsyncAPI source descriptions or `channelPath` steps** — Arazzo 1.1.0 allows them; the runner deliberately does not implement them (#122), and no parser adapter is wired, so such sources return an error annotation (documented in the website parsing guide).

## Open Questions / Uncertain Areas

- The UMD bundles are built but never executed in a browser by CI (roadmap Phase 10).
- Runner modules without a dedicated spec: `abort.ts`, `HTTPClientFetch`, `ParameterDelivery`, `ArazzoValueResolver`, `StepParameterResolver`, `ArazzoWorkflowLocatorNormalizer`, and the index classes (roadmap Phase 6).
- The runner's `src/index.ts` barrel (~40 exports) has not had a deliberate public-vs-internal pass (#78; roadmap Phase 7).
- The root `README.md` links `packages/cli/README.md`, which does not exist; the placeholder is accepted until #84 lands.
- Issue #119's body still says the toolkit targets 1.0.0 / 1.0.1 in the parser and validator; the maintainer confirms 1.1.0 support there, so the issue text is stale.
