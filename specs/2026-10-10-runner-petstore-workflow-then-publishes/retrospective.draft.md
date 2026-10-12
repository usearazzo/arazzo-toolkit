# Phase 5 Retrospective Draft — Runner runs the official petstore workflow, then publishes

> **DRAFT** — written by `/sdd-implement-spec` from tracked implementation deviations. Promote to `retrospective.md` (edit + rename) or delete before merge if nothing here is worth capturing.

## Deviations from the spec

- `plan.md` Group 1 task 7 expected the first e2e run to be red; it was green, because task 5 had already cleaned the fixtures and the two known runner defects only trigger on the externally hosted copy. Group 2's fixes are therefore covered by unit tests, not by a failing e2e run.
- `plan.md` Group 1 task 6: the order workflow needed `preferredPetStatus` and `orderQuantity` passed explicitly, because the runner does not apply input-schema defaults (#97).
- `plan.md` Group 1 task 5: no existing test asserted on the changed fixture values, and both simple conditions already parsed with `parseCriterionCondition`, so neither needed rewriting.
- `plan.md` Group 2 task 11: `test/executor/StepExecutor.ts` held no old-error assertions; only `test/executor/OpenAPIOperationExecutor.ts` changed.
- `validation.md` check 7: a Path Item pointer and a pointer to a nonexistent path reject with `ExtractionError`, but the messages read "expected /paths/{path}/{method}" and "Failed to evaluate pointer", not "does not reference an operation".
- `plan.md` Group 2 (not listed): `OpenAPIOperationExtractor.extractByPointer` crashed with a `TypeError` on a string that is not a JSON Pointer, because `parse` returns no tree instead of throwing; fixed with a unit test, since moving extraction first exposed it.
- `plan.md` Group 2 tasks 8–9: `test/fixtures/workflow-composition.arazzo.yaml` used a literal output (`nextStatus: sold`); changed to `$statusCode`, and the dependent test comments updated.
- `plan.md` Group 2 task 8: used `test` from `@swaggerexpert/arazzo-runtime-expression` (already used by `ArazzoValueResolver`) rather than `parseRuntimeExpression`.

## Root cause

[ONE_OR_TWO_SHORT_PARAGRAPHS — why the spec missed this: what assumption was wrong, what was not checked at spec time.]

## Lesson for future specs

[LESSON_1 — one imperative sentence a future spec author can apply.]

## Promotion candidate

no — update if this lesson names a load-bearing invariant for `specs/tech-stack.md`.
