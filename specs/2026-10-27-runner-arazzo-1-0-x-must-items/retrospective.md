# Phase 8 Retrospective — Runner Arazzo 1.0.x MUST items

Phase 8 shipped in three pull requests: #283 (#126), #284 (#127) and #288 (#117).

## Deviations from the spec

### #126 — parameter location (#283)

- `requirements.md` Out of Scope ("Version-tagging") and `validation.md` Not Required say the three rules "read the same in 1.0.0, 1.0.1, and 1.1.0". For #126 that is wrong. The Arazzo 1.0.0 Parameter Object's `in` description lists `"path"`, `"query"`, `"header"`, `"cookie"`, or `"body"`, and 1.0.1 removed `"body"`. Behavior still matches the spec: `in: body` is rejected in every version (maintainer decision). 1.0.0 contradicts itself (its summary of locations names only four), 1.0.1 is an errata release, `requestBody` covers payloads in every version, OpenAPI 2.0 body parameters included, and the validator rejects `in: body` in 1.0.0 too.
- `plan.md` task 1 put the location check in `OpenAPIOperationParameterResolver` with the allowed set inline. The set lives on `ParameterIdentity` instead (`LOCATIONS`, `hasDefinedLocation`), the domain object that already reads a parameter's `(name, in)` (maintainer request).
- Not in the spec: two documentation fixes landed alongside plan task 11. The location rule was scoped to "a step that calls an operation" (a step calling a workflow maps its parameters to inputs and ignores `in`), and a stale paragraph claiming parameters are keyed by `name` alone, untrue since #41, was removed.

### #127 — unreadable `successCriteria` (#284)

- `plan.md` tasks 4 and 6 placed the check before each step's own request. `WorkflowExecutor` checks every step of a workflow at run start instead, next to `#orderedSteps` and `#validateWorkflowOutputsShape`, a step calling a workflow included. The `StepExecutor.execute()` check stays for direct callers. Otherwise a malformed `successCriteria` on step three would still cost the run the live requests of steps one and two.
- The plan contradicted itself on the public surface. Task 4 specifies a public `StepExecutor.assertSuccessCriteria(step)`, but task 17 and `validation.md` check 2 say the public surface does not change. The implementation follows task 4, and the method is public.
- Not in the spec: the method takes an optional `workflowId`, which the error carries when the workflow-start check raises it, because step ids are only unique within a workflow. This came from the adversarial review.

### #117 — workflow default actions (#288)

- `requirements.md` (#117 decision) and `plan.md` task 8 say "within the step's list and within the workflow's list alike, the first action with a given `name` wins". The implementation keeps a step's own list exactly as written, duplicate names included, and applies first-wins only within the workflow's list. Deduplicating the step's own list would have silently dropped an action a step declared, changing how a document that ignores the validator's `name--unique` error runs. That is a rewrite of authored content, not inheritance. The adversarial review found it with a probe, and the maintainer chose to keep the step's list.
- Not in the spec: existing tests and fixtures asserted or described the old wholesale override, and were rewritten. That was three `ArazzoWorkflowNormalizer` specs, two `WorkflowExecutor` specs, a fixture workflow (`emptyOnSuccessSuppressesDefault`, renamed `emptyOnSuccessKeepsDefault`) and three fixture comments.
- Not in the spec: the website's "What steps inherit" lead-in ("two things, and they behave in opposite ways") became false once actions merge like parameters, and was rewritten along with the "Default actions" paragraph.

## Root cause

The scaffolding read the issues and the current code, but not three neighbouring sources it depended on.

- **The specification text per version.** The #126 version claim came from the issue ("Arazzo 1.0.1 removed `in: body`") and from 1.1.0 being unchanged, without reading the 1.0.0 text.
- **Where the runner already puts the same kind of check.** For #127 the spec reasoned "before the request" one step at a time, missing that `WorkflowExecutor` already runs shape checks at workflow start for exactly this reason.
- **What a rule does to valid and invalid documents alike.** The #117 decision stated first-wins as a property of the merge, without separating the inheritance it governs from the author's own list it would also have rewritten.

The plan was not checked for internal consistency: task 4 made a method public while task 17 and check 2 said the surface does not change. And the website section's lead-in was not re-read against the paragraph being rewritten, so the page briefly contradicted itself.

## Lesson for future specs

- When a spec states that behavior does not vary by Arazzo version, quote the relevant field from each of the 1.0.0, 1.0.1 and 1.1.0 texts rather than inferring it from an issue. 1.0.1 is an errata release that changed normative lists.
- When a spec adds an authoring-error check to the runner that needs no run state, place it with the existing up-front checks (`WorkflowExecutor`'s `#orderedSteps` / `#validateWorkflowOutputsShape`), so the error precedes every request of the workflow, not just the offending step's.
- When a fix normalizes or merges authored content, keep what the author wrote as written and change only what is inherited or derived. Leave diagnosing invalid content (duplicate names and the like) to the validator.
- Check the plan against itself before review: a task that makes something public and a Verify step that says the public surface does not change cannot both hold. A check shared by `StepExecutor` and `WorkflowExecutor` has to be public.
- For each documentation task, check that the target structure exists (the spec review caught that the Errors table has no reasons column), and re-read the surrounding section for claims that the change contradicts.
- Make every `--grep` check in `validation.md` name the context or title phrase each new spec must carry, and place specs accordingly. Mocha matches the full title, so a spec put in another context is silently not selected. In #288 the `$components` merge spec was missed by check 7 until the review moved it.
- When a phase edits `usearazzo/website`, regenerate `assets/css/tailwind.css` before pushing. Tailwind scans prose for class names, so removing the word "collapse" failed the site's "Tailwind CSS is up to date" check.

## Promotion candidate

Yes, for one lesson. "An authoring error that needs no run state is detected at workflow start, before any request of the workflow" refines the mission's "authoring mistakes are reported before any live request fires". The runner now relies on it in three places (`steps`, `outputs`, `successCriteria`), so it is a candidate for the runner architecture contract in `specs/tech-stack.md`. The other lessons are empirical reminders for `specs/lessons.md`.
