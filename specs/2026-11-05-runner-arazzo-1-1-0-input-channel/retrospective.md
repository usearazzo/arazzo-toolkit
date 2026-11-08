# Phase 12 Retrospective — Runner Arazzo 1.1.0 input channel and criterion semantics

## Deviations from the spec

- `plan.md` Group 1, task 1: the stop condition fired. With `@speclynx/apidom-reference` 6.1.2, a `$components.parameters` reference nested inside a `$components.successActions` entry was still a `ReusableElement` after `ArazzoWorkflowNormalizer.normalize`. The arazzo-1 dereference visitor calls `path.skip()` after transcluding, so it never visits the transcluded action. Implementation halted, the bug was fixed upstream (speclynx/apidom#751) and released in apidom 7.0.0, and the branch gained an unplanned `chore(deps)` commit. That commit bumps the whole `@speclynx/apidom-*` set across every package and migrates the runner off the `CriterionExpressionType*` aliases that 7.0.0 removed.

## Root cause

The spec suspected the gap but did not test it. `plan.md` wrote "if it is still a `ReusableElement`, stop" as a runtime contingency, when the question could have been answered while writing the spec: dereference one fixture workflow and print the element type. Because it was left open, a cross-package dependency bump, the largest change on the branch, was discovered halfway through implementation and was never part of the plan or the validation gates.

## Lesson for future specs

- When a spec depends on upstream ApiDOM behavior that it is not sure of (dereferencing, refraction, metadata such as `ref-fields`), `/sdd-new-spec` probes it against the installed version before writing `plan.md`, using a small script over a fixture. If the probe fails, the upstream fix and the dependency bump become planned tasks, with their own validation check (every package's suite passes on the new version), not a stop condition.

## Promotion candidate

no — an empirical reminder for `specs/lessons.md`, not a load-bearing invariant.
