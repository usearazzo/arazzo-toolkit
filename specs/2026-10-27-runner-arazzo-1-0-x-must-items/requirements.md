# Phase 8 Requirements — Runner Arazzo 1.0.x MUST items

## Scope

The runner stops silently getting three Arazzo 1.0.x rules wrong. Today a step can remove the workflow's default actions by declaring its own list, which the specification forbids (#117). A parameter with `in: body`, a location 1.0.1 removed, is forwarded to the request builder, and against an OpenAPI 2.0 operation it can still deliver a body (#126). And a `successCriteria` entry that is not a Criterion Object is skipped, so a step whose only assertion is unreadable succeeds (#127).

Each fix makes the runner do what the specification says, or reject the document with a typed error before any request is sent. The phase is implemented issue by issue, one pull request per issue, in the order the plan gives.

## Out of Scope

- **#129** (embedded runtime expressions in `requestBody` payloads), the roadmap's fourth Phase 8 bullet. It shipped on 2026-10-10 and needs no work here.
- **#120**, criterion *evaluation* errors failing the criterion. That is the Arazzo 1.1.0 rule scheduled in Phase 12. This phase handles only criteria that are structurally unreadable, not conditions that fail to evaluate.
- **The validator's missing `querystring` location.** `@usearazzo/validator` flags `in: querystring` (Arazzo 1.1.0) as invalid, while the runner accepts and delivers it. That gap belongs to the validator (#281), and this phase does not widen it.
- **A validator diagnostic for step actions that shadow workflow actions** (#117 notes it as optional). The runner's merge needs no validator support.
- **Version-tagging.** The three rules read the same in Arazzo 1.0.0, 1.0.1 and 1.1.0, so the behavior does not branch on the `arazzo` field.

## Decisions

### #117 — Workflow default actions merge by `name`

A step's `onSuccess` / `onFailure` no longer replaces the workflow's `successActions` / `failureActions` wholesale. Each step action replaces the workflow action with the same `name`, and every workflow action the step does not name still applies. The effective list is the step's own actions in their order, followed by the workflow actions it did not override, in theirs. Order matters because action selection is first-match-wins. This is the reading that makes both halves of the specification's sentence true ("can be overridden at the step level but cannot be removed there"), and it gives the required `name` field a purpose. `onSuccess: []` therefore inherits every workflow action rather than removing them. Within the step's list and within the workflow's list alike, the first action with a given `name` wins. An entry without a readable `name` neither overrides nor is overridden. A `onSuccess` / `onFailure` that is present but not a list is left for the executor to report, as today. Success and failure still fall back independently.

This is the largest behavior change in the phase. A step that declares a narrow `onFailure` today runs only that list, and afterwards it also inherits the workflow's differently named failure actions. That can include an unconditional `end` that changes where a run stops.

Alternatives weighed: keep wholesale override (today's behavior, which does the one thing the specification prohibits), or keep wholesale override but stop treating an empty list as an override (the smallest change, but it leaves `name` meaningless and a non-empty list can still remove defaults).

### #126 — Reject a parameter location outside the defined set

A step parameter whose `in` is not one of `path`, `query`, `header`, `cookie`, or `querystring` (Arazzo 1.1.0, which the runner already delivers) throws `ResolverError` with `reason: 'invalid-location'`, naming the parameter and its location. The reason name follows the resolver's existing `missing-location` / `malformed-location` rather than the `invalid-parameter-in` sketched in #126. It throws during parameter resolution, before any request. `in: body` is rejected the same way against every OpenAPI version, so the OpenAPI 2.0 pass-through ends. The alternatives were warn-and-drop, which needs a reporting channel that does not exist yet (#85), and documenting the pass-through as a compatibility feature, which contradicts the specification's closed list.

### #127 — Reject an unreadable `successCriteria` before the request

A `successCriteria` that is present but not a list throws `ResolverError` with `reason: 'malformed-criteria'`, and a list entry that is not a Criterion Object throws with `reason: 'malformed-criterion'`. These are the reasons `ActionResolver` already uses for an action's `criteria`. The check runs before the step's request is sent, and for a step that targets a `workflowId`, before the sub-workflow runs, so no live side effect precedes the error. The alternative was to fail the criterion (step unsuccessful, no throw), the lean recorded in #127 ahead of #120's 1.1.0 rule. It was not chosen because nothing would report why the step failed (#231), and because the mission requires authoring errors to be reported before any request fires.

## Constraints

- **Authoring errors throw, failed runs resolve** (`specs/tech-stack.md`, Constraints). #126 and #127 are authoring errors, so they throw typed errors. #117 changes which actions run, not whether a run fails.
- **Authoring mistakes are reported before any live request fires** (`specs/mission.md`, What Success Looks Like). This places both new throws: #126 in parameter resolution, #127 ahead of the request and of any sub-workflow.
- **One engine, no disagreement** (`specs/tech-stack.md`, Constraints). Each construct the runner newly rejects must also be an error diagnostic in `@usearazzo/validator`. `in: body` is (`ARAZZO_PARAMETER_FIELD_IN_EQUALS`), and so is a `successCriteria` that is not an array of Criterion Objects. The validator check in `validation.md` confirms both.
- **Runner architecture contract** (`specs/tech-stack.md`, Constraints). Action inheritance stays in `ArazzoWorkflowNormalizer`, so executors keep reading only `step.onSuccess` / `step.onFailure`. Collaborators stay constructor-bound, with no new per-call parameters.
- **Everything stays ApiDOM** (`specs/tech-stack.md`). The merge works on `SuccessActionElement` / `FailureActionElement` and their `name`, after `$components` references are dereferenced, which the normalizer already does before inheriting (`ArazzoWorkflowNormalizer.ts`, `normalize()`).

## Context

Phase 8 is the runner's 1.0.x conformance pass, scheduled after the runner was published (Phase 5) and before the API freeze (Phase 13). All three issues have the same shape as #273, fixed in #279: the runner did something the document did not say, without telling anyone. The runner's position since publishing has been that a document that does not say what its author meant fails loudly. `ActionResolver` already does that for action criteria, and these fixes extend it to `successCriteria` and parameter locations.

The user-facing description of these behaviors lives in `usearazzo/website` `_reference/runner.md` (the "Default actions replace" paragraph, and the prose where each `ResolverError` reason is described), not in the short `packages/runner/README.md`. That page must describe the new behavior in the same change as each issue.
