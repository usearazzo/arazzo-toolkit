---
type: constitution
section: roadmap
generated_by: spec-driven-agent
generated_at: 2026-09-11T22:07:08Z
confidence: medium
---

# Roadmap

**Phases marked ✅ have shipped; everything else is planned.**

Phases are intentionally small — each one is a shippable, independently reviewable, and testable slice of work. The roadmap starts from the repository's current state: four packages at `1.0.1-alpha.2`, only `@usearazzo/parser` published, the runner complete for Arazzo 1.0.x control flow but unpublished. Direction chosen at bootstrap: publish `resolver` and `validator` first, publish the runner the moment the official petstore workflow runs end to end (#79, #106), then harden it under the alpha channel, then the CLI (#84), then the runner's Arazzo 1.1.0 constructs (#119).

**Priority values:** `High`, `Medium–High`, `Medium`. `(blocker)` is appended only when a phase fixes a gap that makes the system unsafe for its current intended use. Nothing in this roadmap carries `(blocker)` today.

**Lifecycle:** when a phase ships, append ` ✅` (a single space followed by the U+2705 checkmark) to its `## Phase N — Title` heading and leave the rest of the block in place — do not delete or renumber. The leading space is load-bearing — completion-verify steps `grep -F` for the exact ` ✅` suffix. Phase numbers are stable identifiers; completed phases stay in the file as history. New work takes the next number after the largest existing phase.

## Phase 1 — Publish @usearazzo/resolver

**Goal:** `@usearazzo/resolver` is on npm with a surface that covers dereferencing, resolving, and bundling for Arazzo and OpenAPI; the first release is cut by hand, every release after it goes through `release.yml` trusted publishing.  
**Depends on:** none  
**Priority:** High

- Expose resolving and bundling next to the existing dereferencing functions, for both Arazzo and OpenAPI, from paths and URLs and from ApiDOM elements, each backed by the matching `@speclynx/apidom-reference` strategies and a typed error class. Rewrite the resolver invariant in `specs/tech-stack.md` to match.
- Audit `packages/resolver/src/index.ts` against `packages/resolver/README.md`; every export carries `@public` and a README entry, `typescript:declaration` runs clean.
- Cut the README down to the parser's concise shape and write `_reference/resolver.md` in `usearazzo/website` as the full reference, including the in-memory contract: the resolver takes paths and URLs; object and string input is parsed first and handed to the `*Element` variants with `resolve.baseURI`, since in-memory dereferencing belongs to `@speclynx/apidom-reference`.
- Fix the `@usearazzo/parser` dependency pin to the published parser version and align the package version with `lerna.json`.
- Remove `"private": true`; publish the first alpha manually, register the GitHub Actions trusted publisher for the package on npm, and confirm `release.yml` picks the package up with `--no-private` from then on.

## Phase 2 — Arazzo version conformance fixtures

**Goal:** the supported Arazzo 1.0.0 / 1.0.1 / 1.1.0 range is exercised by this repository's own tests, not only inherited from ApiDOM.  
**Depends on:** none  
**Priority:** High

- Add minimal `1.0.0` and `1.1.0` fixtures next to the existing `1.0.1` ones in parser, resolver, and validator tests.
- In the runner, tag the already-implemented 1.1.0 rules (null criterion context fails, `retryAfter` semantics) with version-specific cases; 1.1.0 constructs not yet implemented stay with #119.
- Record any behavior that differs by version in the package README so consumers know what changes with the `arazzo` field.

## Phase 3 — Validator rules reference on the website

**Goal:** every rule the validator enforces is documented where the parser reference already lives.  
**Depends on:** none  
**Priority:** High

- Write `_reference/validator.md` in `usearazzo/website` listing each semantic validation and linting rule with its diagnostic code and severity; point `packages/validator/README.md` at it and remove the dead `docs/rules.md` link (closes #27).
- State the permissive defaults (`fileAllowList: ['*']`, source description resolution on) as a decision in the README security section, with the opt-down recipe for untrusted input.
- Add tests for the `ARAZZO_NOT_DETECTED` path and for `validateURI` base URI injection.

## Phase 4 — Publish @usearazzo/validator

**Goal:** the validator is installable from npm.  
**Depends on:** Phase 3  
**Priority:** High

- Audit `src/index.ts` exports for `@public` and README coverage; `typescript:declaration` runs clean.
- Fix the `@usearazzo/parser` dependency pin to the published parser version.
- Remove `"private": true`; confirm the release workflow publishes it; replace the root README validator placeholder with a short section linking the package README.

## Phase 5 — Runner runs the official petstore workflow, then publishes

**Goal:** the runner executes the official petstore workflow end to end against a live petstore, and `@usearazzo/runner` goes on npm the moment it does. This is the only publishing gate.  
**Depends on:** none  
**Priority:** High

- Add the opt-in end-to-end suite from #79 (env-gated or a separate npm script so `build.yml` stays deterministic) running `petstore-order-workflow.arazzo.yaml` and the official Arazzo Specification petstore example (#106) against a live petstore instance, exercising server resolution and the full pipeline.
- Fix whatever the run surfaces until the suite passes; anything it does not surface is not a gate.
- Fix the `@usearazzo/parser` and `@usearazzo/resolver` dependency pins; remove `"private": true`; confirm the release workflow publishes it.
- Replace the "under heavy development" README warning with an alpha-channel note (APIs may still change before 1.0.0), and replace the root README runner placeholder.

## Phase 6 — Runner coverage for untested modules

**Goal:** every runner module has a dedicated spec.  
**Depends on:** none  
**Priority:** Medium–High

- Add specs for `abort.ts`, `HTTPClientFetch`, `ParameterDelivery`, `ArazzoValueResolver`, `StepParameterResolver`, `ArazzoWorkflowLocatorNormalizer`, and the index classes.
- Add a `ParameterDelivery` test that pins swagger-client's `'{in}.{name}'` addressing so a vendored-bundle bump surfaces drift.

## Phase 7 — Runner pre-1.0 API surface review

**Goal:** every export in the runner barrel is a deliberate building block or is marked internal (#78), while the alpha channel still permits breaking changes.  
**Depends on:** Phase 5  
**Priority:** Medium–High

- Classify each `src/index.ts` export as public building block or internal decomposition; unexport or `@internal` the latter, following the precedent set for `WorkflowCallStack`, `StepRetryRunner`, and `StepTransitionInterpreter`.
- Fold in the small consolidation issues that change the surface (#75, #76, #77) where they affect exports.
- Regenerate the api-extractor rollup and update the README so every public symbol has an entry.

## Phase 8 — Runner Arazzo 1.0.x MUST items

**Goal:** the runner honors every 1.0.x MUST it currently misses.  
**Depends on:** Phase 5  
**Priority:** Medium–High

- Workflow-level action defaults cannot be removed by a step override (#117).
- `in: body` parameters are rejected or handled per OpenAPI 2 semantics instead of silently forwarded (#126).
- A `successCriteria` entry that is not a Criterion Object is an authoring error, not silently skipped (#127).
- Embedded runtime expressions in `requestBody` payloads are evaluated per the 1.0.1 MUST (#129).

## Phase 9 — Runner entry facade

**Goal:** a consumer can run a workflow with one call.  
**Depends on:** Phase 7  
**Priority:** Medium

- Add a thin facade (working name `ArazzoRunner`) that wires `DocumentRegistry`, providers, and executors with defaults, without hiding the injectable seams.
- Document it as the recommended entry in the README; the building blocks stay public for tool builders.

## Phase 10 — Browser bundle smoke tests

**Goal:** the isomorphic contract is verified, not assumed.  
**Depends on:** none  
**Priority:** Medium

- Add a browser smoke test per package that loads the UMD bundle in a headless browser and exercises one call (`parseArazzo` on an inline document, `validate` on a `TextDocument`, `dereferenceArazzoElement`, one runner request through a stub `HTTPClient`).
- Run it in `nightly-build.yml` first; promote to `build.yml` once stable.

## Phase 11 — CLI package

**Goal:** `@usearazzo/cli` exists per the #84 proposal, wrapping the validator and runner, and the root README stops pointing at a package that does not exist.  
**Depends on:** Phase 4, Phase 5  
**Priority:** Medium

- Scaffold `packages/cli` with the same build, lint, and test shape as the other packages, declaring a `bin`.
- Implement the command surface agreed in #84 with exit codes suited to CI; workflow enumeration (#83) lands in the runner first if the CLI needs it.
- Replace the root README CLI placeholder; add the package to `release.yml`.

## Phase 12 — Runner Arazzo 1.1.0 input channel and criterion semantics

**Goal:** the two 1.1.0 items that change observable behavior the most land first after publish.  
**Depends on:** Phase 5  
**Priority:** Medium–High

- Success and failure action `parameters` feed `goto` and `retry` workflow targets (#115), closing the input gap #62 records for 1.0.x.
- Criterion evaluation errors fail the criterion instead of aborting the step (#120).
- Version-tag both behaviors so 1.0.x documents keep their current semantics.

## Phase 13 — API freeze and beta channel

**Goal:** every published package's public surface is reviewed, frozen for 1.x, and released under `beta`.  
**Depends on:** Phase 7  
**Priority:** Medium

- Run the same public-vs-internal pass done for the runner in Phase 7 over `parser`, `resolver`, and `validator`; mark internals `@internal`, regenerate api-extractor rollups.
- Switch `release.yml` from `--preid alpha` to `--preid beta`; cut the first beta.
- From this point any change to a published export is a breaking change and needs a decision, not a commit.

## Phase 14 — 1.0.0 GA

**Goal:** the first release without a prerelease tag.  
**Depends on:** Phase 11, Phase 13  
**Priority:** Medium

- Every package in the monorepo is published: parser, resolver (Phase 1), validator (Phase 4), runner (Phase 5), CLI (Phase 11).
- The official petstore workflows run end to end: the opt-in #79 / #106 suite is executed against a live petstore and is green at release time.
- `usearazzo/website` has a `_reference` page for every package, each checked against `src/index.ts` and the rolled-up `.d.ts` (the parser page already is; the validator page lands in Phase 3).
- Drop `--preid` in `release.yml`; cut `1.0.0`; update `.github/SECURITY.md` to the supported `1.x` range.
- Arazzo 1.1.0 runner constructs are not a gate; they continue under 1.x minors.

## Later Phases (Not Yet Planned)

- Remaining Arazzo 1.1.0 runner constructs under #119, each a candidate phase via `/sdd-new-phase`: Selector Objects (#123), payload replacement targets beyond JSON Pointer (#124), `$self` (#121), step-level `dependsOn` (#104), implicit dependencies from output references (#112), step timeouts (#114), `Retry-After` header (#125).
- AsyncAPI v3 steps (#122) — deliberately excluded; revisited only by an explicit decision.
- Runner observability event stream (#85) and CLI progress rendering (#86); record/replay (#101); resumable execution (#96); request/response validation against OpenAPI schemas (#100); input schema validation (#97); retry delay policy (#98); cookie jar (#118).
- Ecosystem items from the website roadmap: GitHub Action, MCP server, MCP compiler, VS Code extension, language service, Arazzo transformers. Placement (this monorepo or a sibling repository) is decided per item when it is started.
- Modeling Arazzo securities in the runner, only if a future Arazzo version defines a security model.

<!-- Only include items here if they are clearly out of current scope. -->
