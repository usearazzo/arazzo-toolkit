# Phase 1 Validation — Publish @usearazzo/resolver

## Definition of Done

All of the following must be true before this branch is merged.

### 1. Resolver suite is green with the new operations

```
cd packages/resolver && npm test
```

Exits 0. The output lists the describe titles `resolveArazzo`, `resolveArazzoElement`, `resolveOpenAPI`, `resolveOpenAPIElement`, `bundleArazzo`, `bundleArazzoElement`, `bundleOpenAPI`, `bundleOpenAPIElement`, and the total passing count is above the 58 cases the suite had before this phase, with zero failing and zero pending.

### 2. Public surface rolls up clean

```
cd packages/resolver && npm run typescript:declaration
```

Exits 0 with no `ae-` warning in the api-extractor output.

```
grep -cE "\b(resolveArazzo|resolveArazzoElement|resolveOpenAPI|resolveOpenAPIElement|bundleArazzo|bundleArazzoElement|bundleOpenAPI|bundleOpenAPIElement|defaultResolveArazzoOptions|defaultResolveOpenAPIOptions|defaultBundleArazzoOptions|defaultBundleOpenAPIOptions|ResolveArazzoOptions|ResolveOpenAPIOptions|BundleArazzoOptions|BundleOpenAPIOptions|ResolveError|BundleError)\b" packages/resolver/types/resolver.d.ts
```

Prints a number of at least 18, and every one of the 18 names appears in the file as an `export` declaration.

### 3. Consumer suite passes

```
cd packages/runner && npm test
```

Exits 0. The runner imports `dereferenceArazzoElement` and `dereferenceOpenAPIElement`, which now go through the element-context modules.

### 4. Lint and type check

```
npm run lint && npm run typescript:check-types
```

Both exit 0 at the repository root.

### 5. Manifest is publishable

`packages/resolver/package.json` has no `private` key, `"version": "1.0.1-alpha.2"`, and `"@usearazzo/parser": "1.0.1-alpha.2"`. The `packages/resolver` entry in `package-lock.json` shows `"version": "1.0.1-alpha.2"`.

```
npx lerna ls --no-private
```

Prints exactly two lines: `@usearazzo/parser` and `@usearazzo/resolver`.

### 6. Publish dry run

```
cd packages/resolver && npm run build && npm publish --dry-run --provenance=false
```

Exits 0 and names `@usearazzo/resolver@1.0.1-alpha.2`. The tarball listing contains `types/resolver.d.ts`, `dist/arazzo-resolver.browser.min.js`, `src/index.mjs`, `src/index.cjs`, `README.md`, `LICENSE`, `NOTICE`, and contains no `.ts` source, no `test/` and no `config/` entry.

### 7. README, constitution, roadmap

`packages/resolver/README.md` contains an "At a glance" table naming all twelve functions, the in-memory contract sentence, and the link `https://usearazzo.com/docs/resolver/`; it no longer contains the long-form option, source-description, and error-handling sections. `specs/tech-stack.md`'s resolver bullet under § Constraints and Conventions mentions dereference, resolve and bundle and no longer says bundling belongs to apidom-reference.

```
grep -F "## Phase 1 — Publish @usearazzo/resolver ✅" specs/roadmap.md
```

Exits 0.

### 8. CI is green

Every job in `.github/workflows/build.yml` (`lint-commit-messages`, `lint`, `check-typescript-types`, `test`, `build`) passes on the PR.

## Not Required

- The manual `npm publish`, the trusted-publisher registration on npmjs.com, and the first `release.yml` run with the resolver included happen after merge, following the runbook in `requirements.md`. None is a pre-merge gate.
- `_reference/resolver.md` in `usearazzo/website`. The site only carries reference pages for packages that resolve on npm, so it is written after the manual publish in a separate PR there.
- No browser smoke test of the UMD bundle (Phase 10) and no tarball install into a scratch project; the publish dry run is the packaging check.
- No validator suite run; the validator does not depend on the resolver.
- No public-vs-internal API review (Phase 13).
- No `packages/resolver/CHANGELOG.md`; `lerna version` generates it on the first workflow release.
