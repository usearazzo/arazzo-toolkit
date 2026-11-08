# Phase 12 Retrospective — Runner Arazzo 1.1.0 input channel and criterion semantics

## Deviations from the spec

- `plan.md` Group 1, task 1: the stop condition fired. With `@speclynx/apidom-reference` 6.1.2, a `$components.parameters` reference nested inside a `$components.successActions` entry was still a `ReusableElement` after `ArazzoWorkflowNormalizer.normalize`. The arazzo-1 dereference visitor calls `path.skip()` after transcluding, so it never visits the transcluded action. Implementation halted, the bug was fixed upstream (speclynx/apidom#751) and released in apidom 7.0.0, and the branch gained an unplanned `chore(deps)` commit. That commit bumps the whole `@speclynx/apidom-*` set across every package and migrates the runner off the `CriterionExpressionType*` aliases that 7.0.0 removed.

- `requirements.md` § *An inline `in` throws when the action fires* (and `validation.md` check 1's "only when the action fires" case) was reversed after merge, in #335. Running the feature the way a user would, validate then run, showed the problem. `usearazzo validate` said nothing about an inline `in`, because the matching rule was only an idea on #197. The runner then threw partway through a run, after earlier steps had sent live requests. That breaks the mission's "authoring mistakes are reported as typed errors before any live request fires" and the rule that the runner is only as strict as the validator. #335 checks every action's `parameters` (inline `in`, non-list) before the workflow's first request, the workflow's own `successActions` / `failureActions` included. #336 brought the validator rule upstream (`parameters--no-in`, @speclynx/api-languageservice 3.0.4), so validate and run now agree.

## Root cause

The spec suspected the gap but did not test it. `plan.md` wrote "if it is still a `ReusableElement`, stop" as a runtime contingency, when the question could have been answered while writing the spec: dereference one fixture workflow and print the element type. Because it was left open, a cross-package dependency bump, the largest change on the branch, was discovered halfway through implementation and was never part of the plan or the validation gates.

The `in` decision was judged against the specification text ("MUST NOT be used") and the timing of value resolution, not against what a user sees. The validator half was deferred to an upstream idea, so the runner ended up stricter than the validator. The validation checks only exercised the runner, so nothing ran the validator and the runner over the same document.

## Lesson for future specs

- When a spec depends on upstream ApiDOM behavior that it is not sure of (dereferencing, refraction, metadata such as `ref-fields`), `/sdd-new-spec` probes it against the installed version before writing `plan.md`, using a small script over a fixture. If the probe fails, the upstream fix and the dependency bump become planned tasks, with their own validation check (every package's suite passes on the new version), not a stop condition.

- When a spec makes the runner reject something, it also states what `usearazzo validate` reports for the same document, and whether the rejection happens before the first request. If the validator rule does not exist yet, either the rule is planned work in the same phase or the runner stays lenient until it lands. `validation.md` then includes a check that runs the validator and the runner over one document and compares the outcomes.

## Promotion candidate

no — an empirical reminder for `specs/lessons.md`, not a load-bearing invariant.
