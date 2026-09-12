# Phase 1 Requirements — Publish @usearazzo/resolver

## Scope

`@usearazzo/resolver` becomes the second package published under the `@usearazzo` scope. The phase has two halves. The first is the surface: the package grows resolving (`resolveArazzo`, `resolveOpenAPI`, and their `*Element` variants, returning the `ReferenceSet` that `@speclynx/apidom-reference` builds) and bundling (`bundleArazzo`, `bundleOpenAPI`, and their `*Element` variants, returning a compound document) next to the four dereference functions that already exist. The first published version then exposes all three reference operations for both document kinds, and every one of them follows the same input contract, option shape, and typed-error pattern.

The second half is release readiness. The package manifest is fixed (published parser pin, version aligned with `lerna.json`, `"private": true` removed), the README is cut to the parser's concise shape with the full reference moving to `usearazzo/website`, the constitution's resolver invariant is rewritten, and a runbook records the first manual publish and the trusted-publisher registration that lets `release.yml` carry every later release. When the implementation PR merges, the maintainer can publish by hand from `main` with no further code change.

## Out of Scope

- No runner changes. The runner keeps consuming the resolver through the workspace symlink; its own `@usearazzo/parser` and `@usearazzo/resolver` pins are corrected in Phase 5.
- No `MemoryResolver` and no object or string input on the path/URL entry points. In-memory input is parsed first and handed to the `*Element` variants, exactly as for dereferencing today.
- No `_reference/resolver.md` before the package resolves on npm. The website only carries reference pages for published packages, so that page is written right after the manual publish, in a `usearazzo/website` PR, from the concise README and the rolled-up `types/resolver.d.ts`.
- No public-vs-internal freeze of the surface. That review is Phase 13; the alpha channel still permits breaking changes.
- No browser smoke test of the UMD bundle. That is Phase 10.

## Decisions

### Resolve and bundle mirror the dereference API
Naming, inputs, and error handling follow the existing four functions one to one. `resolveArazzo(uri, options)` and `resolveOpenAPI(uri, options)` take a file system path or HTTP(S) URL and return a `ReferenceSet`; `resolveArazzoElement(element, options)` and `resolveOpenAPIElement(element, options)` take a `ParseResultElement` (or a child element with `dereference.strategyOpts.parseResult`) and return a `ReferenceSet`. `bundleArazzo` and `bundleOpenAPI` return a `ParseResultElement` whose `api` is a compound document; `bundleArazzoElement` and `bundleOpenAPIElement` return the bundled `ParseResultElement`. Each operation has its own default-options constant (`defaultResolveArazzoOptions`, `defaultBundleArazzoOptions`, and the OpenAPI twins), its own `Options` alias (`ResolveArazzoOptions`, `BundleArazzoOptions`, and the OpenAPI twins), and its own error class: `ResolveError` and `BundleError`, both extending `ApiDOMError` like `DereferenceError`. One shared options set per document kind was weighed and rejected: the parser exports one default constant and one options type per function, and the resolver should read the same way. Relative paths resolve against the working directory, `retrievalURI` metadata is set on path/URL results, and the `*Element` variants derive the base URI from `retrievalURI` metadata or require `resolve.baseURI`, with the same error messages the dereference functions use today.

### Bundle element variants take a ParseResultElement only
`@speclynx/apidom-reference` 5.2.2 has no `bundleApiDOM`. Bundling hoists external resources into the entry document's components, which only makes sense for a whole document, so `bundleArazzoElement` and `bundleOpenAPIElement` accept a `ParseResultElement` and drive the matching bundle strategy directly through the exported `File` and strategy classes. Any other element raises `BundleError`. The resolve element variants keep the child-element scenario because `resolveApiDOM` supports it upstream.

### One element-context module per document kind
The derivation of base URI, media type, and seeded `ReferenceSet` that `dereferenceArazzoElement` and `dereferenceOpenAPIElement` each perform inline today is lifted into one module per document kind and reused by the resolve and bundle element variants. Six inline copies of the same block would drift; one owner per document kind cannot. The dereference functions keep their behavior and messages.

### Version aligned to lerna.json, first publish by hand, then trusted publishing
`packages/resolver/package.json` moves from `1.0.1-alpha.0` to `1.0.1-alpha.2`, matching `lerna.json` and the published parser, and its `@usearazzo/parser` pin moves to `1.0.1-alpha.2`. Lerna fixed mode with `--no-private` never touched the package while it was private, which is why it lags. The parser followed the same path: `1.0.1-alpha.0` was published by hand on 2026-09-03 without provenance, `alpha.1` and `alpha.2` went through `release.yml` with provenance. The manifest's `publishConfig.provenance: true` cannot be honored outside CI, so the manual publish passes `--provenance=false`. `release.yml` needs no change.

Runbook, after the implementation PR merges:

1. On `main`: `source ~/.nvm/nvm.sh && nvm use && npm ci && npm run build && npm test`.
2. `cd packages/resolver && npm publish --provenance=false` (npm asks for the 2FA code; `prepack` copies `LICENSE` and `NOTICE` in, `postpack` removes them).
3. `npm view @usearazzo/resolver version` prints `1.0.1-alpha.2`.
4. On npmjs.com, package `@usearazzo/resolver`, Settings, Trusted Publisher, GitHub Actions: organization `usearazzo`, repository `arazzo-toolkit`, workflow filename `release.yml`, environment name `npm-release`.
5. The next `release.yml` run (`workflow_dispatch` on `main`) bumps parser and resolver to `1.0.1-alpha.3` together, publishes both with provenance, and creates `packages/resolver/CHANGELOG.md`. `npm view @usearazzo/resolver dist.attestations` is populated afterwards.
6. Write `_reference/resolver.md` in `usearazzo/website`; the README's reference link already points at `https://usearazzo.com/docs/resolver/`.

### Concise README, reference on the website
The resolver README is rewritten in the parser README's shape: what it does, an at-a-glance table, installation, one usage example per operation, a pointer to the API reference, supported versions, the toolkit footer. Everything else (options, the in-memory contract in full, source descriptions, error handling, result shapes, `retrievalURI` metadata) moves to `_reference/resolver.md` in `usearazzo/website`, following that repository's reference-page conventions (`CLAUDE.md` § Package reference pages) and written from `types/resolver.d.ts` and `src/`, not mirrored from the old README.

## Constraints

- **Everything stays ApiDOM** — resolve returns `ReferenceSet`s of ApiDOM parse results, bundle returns ApiDOM parse results. Nothing converts to plain JSON.
- **Layering is parse → resolve → validate → run** — the resolver keeps depending on the parser only, reusing `defaultParseArazzoOptions` and `defaultParseOpenAPIOptions` for resolvers and parsers as the dereference defaults already do.
- **Public API is deliberate** — every new export carries `@public` TSDoc, has a README entry, and fails through a typed error (`ResolveError`, `BundleError`). `typescript:declaration` (api-extractor) must run clean.
- **The resolver takes paths and URLs only; in-memory input goes through `*Element` with `resolve.baseURI`** — the invariant in `specs/tech-stack.md` § Constraints and Conventions keeps its meaning, but its wording lists `bundle` as apidom-reference's job; this phase rewrites it to cover the three operations and to keep the "no `MemoryResolver`" rule.
- **Internal workspace pins track the published parser** — `1.0.1-alpha.2` today; a stale exact pin is drift.
- **Isomorphic contract** — the new modules import from `@speclynx/apidom-reference/configuration/empty` and the per-strategy subpaths exactly like the dereference modules, so the UMD bundle stays free of the saturated configuration and of Node-only code paths.
- **Conventional Commits, DCO, squash merge** — scope `resolver` for code, `specs` for the constitution edit.

## Context

The roadmap's first move is to publish the resolver and validator before the runner, and the resolver goes first because its surface is small and the parser already proved the release path. Tool builders consume the resolver as a dependency, so the first published version should be the complete reference layer: dereference for self-contained trees, resolve for the reference graph, bundle for a single compound document. Upstream `@speclynx/apidom-reference` 5.2.2 already ships resolve and bundle strategies for Arazzo 1 and OpenAPI 2, 3.0 and 3.1, so no upstream change is needed and the resolver stays a thin, typed layer over the shared engine.

The runner already imports the dereference functions from `@usearazzo/resolver` (`packages/runner/src/normalizer/*OperationNormalizer.ts`, `ArazzoWorkflowNormalizer.ts`, `registry/providers/OpenAPIDocumentRegistryProvider.ts`), so the runner's suite doubles as the consumer check for the element-context refactor. The README rewrite follows `packages/parser/README.md`; the website page follows `_reference/parser.md`. Phases 4 and 5 repeat the manifest and runbook part of this phase for the validator and the runner.
