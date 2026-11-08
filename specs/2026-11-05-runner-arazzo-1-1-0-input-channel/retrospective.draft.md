# Phase 12 Retrospective Draft — Runner Arazzo 1.1.0 input channel and criterion semantics

> **DRAFT** — written by `/sdd-implement-spec` from tracked implementation deviations. Promote to `retrospective.md` (edit + rename) or delete before merge if nothing here is worth capturing.

## Deviations from the spec

- `plan.md` Group 1, task 1: the stop condition fired. With `@speclynx/apidom-reference` 6.1.2, a `$components.parameters` reference nested in a `$components.successActions` entry was still a `ReusableElement` after `ArazzoWorkflowNormalizer.normalize`, because the arazzo-1 dereference visitor calls `path.skip()` after transcluding. It was fixed upstream (speclynx/apidom#751) and shipped in apidom 7.0.0, so the branch carries an unplanned `chore(deps)` commit. That commit bumps every `@speclynx/apidom-*` package to 7.0.0 and `@speclynx/api-languageservice` to 3.0.3, moves the runner off the removed `CriterionExpressionType*` aliases to `ExpressionType*`, and updates the `specs/tech-stack.md` Data model row from 5.x to 7.x.
- `plan.md` Group 1, task 1: the fixture's cross-document case (`crossDocumentGoto`) references `$components.parameters.sharedToken` without a `value` override. `validation.md` check 2 requires the value to come from the calling document's components, and an override would hide which document supplied it. The target is the existing `childSetup` workflow of `cross-document-child.arazzo.yaml`, which echoes its `token` input.
- `plan.md` Group 1, tasks 2–3: the overlay that builds `actionContext` lives in a new public `StepExecutor.actionContext(context, stepId, outputs)` method, which the workflow executor also calls for a step that calls a workflow. This mirrors `evaluateCriteria` / `selectActions`. The plan described building it inline in both places, which the pre-push review flagged as duplication.
- `plan.md` Group 2, task 6: `#actionInputs` takes the action's `parameters` element, not the action. At the `goto` call site the action is typed `SelectedAction | undefined`, and `Transition` was not to change. Behavior is unchanged. `WorkflowParameterResolver.resolve` widens its `parameters` type to accept Success / Failure Action parameter lists.
- `plan.md` Group 3, task 11: a stale `#62` comment in `test/executor/WorkflowExecutor.ts` was rewritten too. The matching comment in `test/fixtures/workflow-control-flow.arazzo.yaml` (lines 136–144) is still stale, because `validation.md` check 3 requires that fixture to stay unchanged.
- `plan.md` groups vs commits: after the pre-push review, the fixture moved into the Group 2 commit, which has its first consumers, and the Group 3 TSDoc rewrites (task 11) went in with the Group 2 feature commit. The docs commit holds only the README, tech-stack and roadmap edits.

## Root cause

[ONE_OR_TWO_SHORT_PARAGRAPHS — why the spec missed this. Typical causes: missing repo context during scaffolding; an adjacent change landed after the spec was written; an assumption in the roadmap phase turned out to be wrong; a load-bearing constraint was not surfaced in `tech-stack.md`.]

## Lesson for future specs

- [LESSON_1 — actionable guidance for `/sdd-new-spec` and `/sdd-new-phase`, specific enough to apply (not generic advice).]
- [LESSON_2]

## Promotion candidate

no — update if this lesson names a load-bearing invariant for `specs/tech-stack.md`.
