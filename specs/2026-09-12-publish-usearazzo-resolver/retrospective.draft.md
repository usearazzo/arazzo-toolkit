# Phase 1 Retrospective Draft — Publish @usearazzo/resolver

> **DRAFT** — written by `/sdd-implement-spec` from tracked implementation deviations. Promote to `retrospective.md` (edit + rename) or delete before merge if nothing here is worth capturing.

## Deviations from the spec

- `requirements.md` § Decisions "Bundle element variants take a ParseResultElement only" and `plan.md` Group 1 tasks 6–9: `bundleArazzoElement` and `bundleOpenAPIElement` were dropped by maintainer decision during implementation; only whole documents bundle, mirroring `@speclynx/apidom-reference`, which has no `bundleApiDOM`. The surface is ten functions and sixteen new public names, and `validation.md` checks 1, 2 and 7 were applied to that reduced surface (the README table names ten functions, the `.d.ts` grep matches 16 names).
- `requirements.md` § Decisions "One element-context module per document kind" and `plan.md` task 2: the extraction was implemented, then reverted by maintainer decision in favour of inlining the base-URI and media-type derivation in the four `*Element` functions, since each context module had only two callers once the bundle element variants were gone.
- `plan.md` tasks 4 and 5: `resolveArazzoElement` / `resolveOpenAPIElement` cannot forward a seeded `dereference.refSet` to `resolveApiDOM`; the upstream resolve strategies deep-merge a fresh `ReferenceSet` over it (ramda `mergeDeepRight`), which strips the prototype and crashes the resolution. All four resolve functions now drop `dereference.refSet` before calling upstream and document the option as ignored.
- `requirements.md` § Out of Scope "No runner changes" and `plan.md` task 11: `packages/runner/package.json` had its exact `@usearazzo/resolver` pin bumped to `1.0.1-alpha.2`; without it `npm install` cannot match the workspace package and falls back to the registry (404). The runner and validator `@usearazzo/parser` pins were bumped too after review: left at `1.0.1-alpha.0`, they pulled a nested registry parser copy so the runner loaded two parser versions and its suite no longer exercised the workspace parser. `release.yml` runs `lerna version --no-private`, which never rewrites the private packages' exact pins, so this recurs on every release.
- `plan.md` task 13: the lockfile refresh also removed the nested registry copies of `@usearazzo/parser@1.0.1-alpha.0` under `packages/resolver/node_modules` (and, after the pin bump above, under `packages/runner` and `packages/validator`), which the stale pins had been pulling in place of the workspace package.
- `plan.md` task 12: the README "repoints references" wording was wrong for Arazzo bundling, which embeds the external JSON Schema resource under `components.inputs` with its `$id` and leaves the `$ref` as written; corrected in a fix-up commit. `specs/tech-stack.md` § Data and Storage pointed at the README § Options section the rewrite removed; repointed to the website reference.
- `plan.md` task 8: the bundle defaults were copied from the resolve defaults and carried `resolve.strategies` and a `dereference` block (including a `sourceDescriptions` switch) that the upstream bundle pipeline never reads; trimmed after review to the bundle strategies plus the shared resolvers and parsers. The resolve and bundle defaults now spread the dereference defaults instead of re-declaring them.
- `plan.md` tasks 4 and 5: the element variants overwrote a caller-supplied `parse.mediaType`, skipped the document-kind check the URI variants perform, and threw a raw upstream `TypeError` for a child element passed without `strategyOpts.parseResult` or `resolve.baseURI`; all three fixed after review with regression tests, and the root-reference shape for a child element (a wrapper around a copy of the child, keyed by the root URI) is now documented rather than reshaped.

## Root cause

[ONE_OR_TWO_SHORT_PARAGRAPHS — why the spec missed this. Typical causes: missing repo context during scaffolding; an adjacent change landed after the spec was written; an assumption in the roadmap phase turned out to be wrong; a load-bearing constraint was not surfaced in `tech-stack.md`.]

## Lesson for future specs

- [LESSON_1 — actionable guidance for `/sdd-new-spec` and `/sdd-new-phase`, specific enough to apply (not generic advice).]
- [LESSON_2]

## Promotion candidate

no — update if this lesson names a load-bearing invariant for `specs/tech-stack.md`.
