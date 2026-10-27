# Phase 8 Retrospective (draft) — Runner Arazzo 1.0.x MUST items

Raw material gathered during implementation, for the human-curated `retrospective.md` once the phase ships.

## Deviations from the spec

- `requirements.md`, Out of Scope, "Version-tagging", and `validation.md`, Not Required: both state that the three rules "read the same in 1.0.0, 1.0.1, and 1.1.0". For #126 that is not accurate. The Arazzo 1.0.0 Parameter Object's `in` description lists `"path"`, `"query"`, `"header"`, `"cookie"`, or `"body"`, while 1.0.1 lists only the first four. The implementation (#283) still rejects `in: body` in every version, which the maintainer decided on 2026-10-27, so the behavior matches the spec. Only the stated rationale was wrong. Reasons for not version-tagging: 1.0.0 contradicts itself (its summary of locations names only four); 1.0.1 is an errata release that resolved this; `requestBody` already exists in 1.0.0 as the way to send a payload, including to an OpenAPI 2.0 body parameter; and the validator rejects `in: body` in 1.0.0 documents too, so accepting it would split the runner from the validator.

- `plan.md` tasks 4 and 6 (#127) placed the `successCriteria` check before each step's own request (in `StepExecutor.execute()`, and before the sub-workflow for a step that targets a `workflowId`). The #127 implementation keeps the `execute()` check, for direct `StepExecutor` callers, and in `WorkflowExecutor` checks every step of a workflow at the start of the run, next to the existing `#orderedSteps` and `#validateWorkflowOutputsShape` checks, instead of per step. Otherwise a malformed `successCriteria` on step three would still cost the run the live requests of steps one and two, which the mission's "authoring mistakes are reported before any live request fires" rules out and the existing `outputs` check already avoids. Validation check 4 holds unchanged: no request is sent.

## Root cause

The spec's version claim was taken from the issues (#126 says "Arazzo 1.0.1 removed `in: body`") and from the field being unchanged in 1.1.0. Nobody read the 1.0.0 text itself while scaffolding.

For #127 the spec read "before any live request" per step, without checking how the workflow executor already places shape checks. `#validateWorkflowOutputsShape` documents exactly this reasoning at workflow scope.

## Lesson for future specs

- When a spec states that behavior does not vary by Arazzo version, quote the relevant field from each of the 1.0.0, 1.0.1 and 1.1.0 texts rather than inferring it from an issue. 1.0.1 is an errata release that changed normative lists.

- When a spec adds an authoring-error check to the runner, place it with the existing up-front checks (`WorkflowExecutor`'s `#orderedSteps` / `#validateWorkflowOutputsShape`) if it needs no run state, so the error precedes every request of the workflow, not just the offending step's.

## Promotion candidate

No. This is an empirical reminder for `specs/lessons.md`, not a load-bearing invariant.
