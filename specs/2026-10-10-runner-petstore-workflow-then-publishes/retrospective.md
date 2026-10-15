# Phase 5 Retrospective — Runner runs the official petstore workflow, then publishes

## Deviations from the spec

- `plan.md` Group 1 task 7 expected the first e2e run to be red; it was green, because task 5 had already cleaned the fixtures and the two known runner defects only trigger on the externally hosted copy. Group 2's fixes are therefore covered by unit tests, not by a failing e2e run.
- `plan.md` Group 1 task 6: the order workflow needed `preferredPetStatus` and `orderQuantity` passed explicitly, because the runner does not apply input-schema defaults (#97).
- `plan.md` Group 1 task 5: no existing test asserted on the changed fixture values, and both simple conditions already parsed with `parseCriterionCondition`, so neither needed rewriting.
- `plan.md` Group 2 task 11: `test/executor/StepExecutor.ts` held no old-error assertions; only `test/executor/OpenAPIOperationExecutor.ts` changed.
- `validation.md` check 7: a Path Item pointer and a pointer to a nonexistent path reject with `ExtractionError`, but the messages read "expected /paths/{path}/{method}" and "Failed to evaluate pointer", not "does not reference an operation".
- `plan.md` Group 2 (not listed): `OpenAPIOperationExtractor.extractByPointer` crashed with a `TypeError` on a string that is not a JSON Pointer, because `parse` returns no tree instead of throwing; fixed with a unit test, since moving extraction first exposed it.
- `plan.md` Group 2 tasks 8–9: `test/fixtures/workflow-composition.arazzo.yaml` used a literal output (`nextStatus: sold`); changed to `$statusCode`, and the dependent test comments updated.
- `plan.md` Group 2 task 8: used `test` from `@swaggerexpert/arazzo-runtime-expression` (already used by `ArazzoValueResolver`) rather than `parseRuntimeExpression`.
- Review follow-up (not in the spec): `.github/workflows/release.yml` also runs the e2e suite against a petstore service container, because `plan.md` gated only PRs while `requirements.md` calls the e2e suite the publishing gate; the e2e assertions check concrete output values rather than non-empty outputs; and the container hook names its container up front and times out readiness requests.

## Root cause

The spec was scaffolded against the fixtures and the runner as they were described, not as they behaved. It assumed the first e2e run would be red and that the runner honoured input-schema defaults; neither held (the fixtures were already clean, and defaults are unimplemented, #97). It also did not trace where the "publishing gate" is actually enforced: only `build.yml` ran the e2e suite, so the release workflow could publish with a red e2e run.

Moving operation-id extraction ahead of the HTTP call exposed an unguarded `TypeError` in `extractByPointer`, and making `{expression}` fields strict broke a literal-output fixture. Both were reachable only by running the code, not by reading the spec's file list.

## Lesson for future specs

- When a spec expects a test to fail first, check at scaffolding time that the failure is reproducible against the current fixtures, or record that the fixes will be covered by unit tests only.
- When a phase makes strictness changes to authoring-error handling, list the existing fixtures and tests that use the now-invalid forms (literal outputs, bare `context` values) in `plan.md`.
- When a spec names a CI check as a gate, say which workflows enforce it (PR, release, nightly) and whether it must be a required status check.

## Promotion candidate

no — these are empirical reminders for `specs/lessons.md`, not a new constitution invariant.
