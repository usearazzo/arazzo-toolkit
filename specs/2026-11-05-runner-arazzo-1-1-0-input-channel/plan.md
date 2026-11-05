# Phase 12 Plan — Runner Arazzo 1.1.0 input channel and criterion semantics

## Group 1 — Carry the action context to where actions fire

1. Add the test fixture first: `packages/runner/test/fixtures/action-parameters.arazzo.yaml`, with `arazzo: "1.1.0"`, against `petstore.openapi.json`. It covers:
   - a `goto` transfer with `parameters`, and a `retry` workflow reference with `parameters`;
   - parameters reading `$statusCode`, `$response.body#/…`, `$inputs.*` and `$steps.<thisStep>.outputs.*`;
   - a duplicate parameter name, `parameters: []`, a non-list `parameters`, and an inline `in`;
   - a `$components.parameters` reference that carries `in`, used with a `value` override in three places:
     - directly in an action's `parameters`;
     - nested inside a `$components.successActions` / `failureActions` entry;
     - in an action of a workflow reached through `$sourceDescriptions.<name>.<workflowId>`;
   - `parameters` on an `end`, on a `goto` to a `stepId`, and on a `retry` with a `stepId` reference.

   If the nested Reusable Object is still a `ReusableElement` after `ArazzoWorkflowNormalizer.normalize`, stop. Surface it as a dereferencing gap: the arazzo-1 dereference visitor calls `path.skip()` after transcluding, which may leave nested references unresolved. Do not go further until that is settled.
2. In `packages/runner/src/executor/StepExecutor.ts`, add `actionContext: RuntimeExpressionContext` to `StepAttemptOutcome` and to the `@public` `StepExecutionResult`, with TSDoc (see requirements § The action context is a public field). It is `postContext` with `steps[stepId]` replaced by `{ outputs }` from this attempt, built as a fresh object. Update every test helper that builds a `StepAttemptOutcome` or `StepExecutionResult` literal; `grep -rn "matchedActions:" packages/runner/test` finds them.
3. In `WorkflowExecutor.#stepAttempt` (the sub-workflow branch), return the same `actionContext`: the `calledWorkflow` context, overlaid with this attempt's resolved `outputs`.
4. In `packages/runner/src/executor/StepRetryRunner.ts`, change `StepRetryRunContext.runReference` to `(action, outcome) => Promise<void>`, passing the outcome of the attempt that just failed. Update its TSDoc and the callers in `test/executor/StepRetryRunner.ts`.

## Group 2 — Resolve action parameters into the target's inputs

5. In `packages/runner/src/errors/ResolverError.ts`, add `static readonly ActionParameterLocation = 'action-parameter-location' as const`, with TSDoc, and include it in `ResolverErrorReason`.
6. Add the private `WorkflowExecutor.#actionInputs(action, outcome, invocation, stepId)`. Call it only for an action that names a `workflowId`, and only when the action is a `goto` or a `retry`. It:
   - throws `ResolverError.ActionParameterLocation` (`workflowId`, `stepId`, `target: 'parameters'`) for an entry that `isParameterElement`, has an `in` key, and has no `ref-fields` meta. A dereferenced reusable carries `ref-fields`, so it maps by name.
   - otherwise resolves through the existing `WorkflowParameterResolver` against `outcome.actionContext`, via `#evaluate(…, invocation.document)`.

   The existing behaviors stay: first entry wins on a duplicate name; a non-list is `malformed-parameters`; `[]` and an absent list both give `{}`.
7. Give `#runReferencedWorkflow` an `inputs` argument in place of the hard-coded `{}`. In `#run`'s `transfer` case, pass `#actionInputs(action, outcome, …)`, using the `action` and `outcome` already destructured from `#retryRunner.run`. `Transition` and `StepTransitionInterpreter` do not change, and the transfer writes nothing to the caller's `$workflows`.
8. In `#retryReference`, on every firing, call `#actionInputs` with the `outcome` it now receives, before `#chargeBudget`. Pass the result to `#runReferencedWorkflow`. Record it with `state.setWorkflow(refId, { inputs, outputs })` when the action carries a `parameters` key, including `[]`. Without the key, keep the current preserve-or-`{}` rule.
9. Add tests in `packages/runner/test/executor/WorkflowExecutor.ts`, in a new `context('action parameters')`, on the Group 1 fixture through a stub `HTTPClient`. One `specify` per behavior, with these titles:
   - `should pass a goto action's parameters to the transfer target as inputs`
   - `should resolve action parameters against the step's response and its own fresh outputs`
   - `should resolve a retry reference's parameters again on every firing`
   - `should record a retry reference's resolved inputs under $workflows`
   - `should keep earlier recorded inputs for a retry reference without parameters`
   - `should map duplicate action parameter names first-wins`
   - `should resolve parameters: [] to empty inputs`
   - `should throw malformed-parameters for a non-list action parameters`
   - `should throw action-parameter-location for an inline in only when the action fires`
   - `should map a reusable parameter carrying in by name with its value override`
   - `should resolve a reusable parameter nested in a components action`
   - `should ignore parameters on an action without a workflowId`
   - `should not resolve the parameters of an action that matched but did not fire`
   - `should run a workflowId action without parameters with empty inputs`
   - `should throw unavailable-expression for $statusCode in an action parameter of a step calling a workflow`
10. In `test/executor/WorkflowExecutorCrossDocument.ts`, add `specify('should resolve a cross-document action target's parameters against the calling document')`.

## Group 3 — Docs and lifecycle

11. Update the TSDoc in `packages/runner/src/executor/WorkflowExecutor.ts` that says a `retry` reference or `goto` target has no input channel:
    - `#retryReference`: the paragraph from "It runs with no inputs:" through "see issue `#62`";
    - `#runReferencedWorkflow`: "with `{}` inputs, since neither has an input-mapping mechanism of its own (issue `#62`)" and "then run with no inputs";
    - the `RetryReferenceRecord` field docs, if they say the same.

    Afterwards they say: inputs come from the action's `parameters` (#115), `{}` without them. The `dependsOn` and `rejectUnknownOptions` comments at lines 123–125 and 563 stay.
12. In `specs/tech-stack.md`, replace the bullet "**Referenced workflows run with empty inputs in 1.0.x.** …" with "**Action `parameters` feed referenced workflows.** `goto` transfers and `retry` `workflowId` references receive their action's `parameters` as inputs, resolved in the step's action context (#115); an action without `parameters` receives `{}`; `dependsOn` has no input mapping and takes its inputs only from `dependencyInputs`, else `{}` (#62)."
13. In `packages/runner/README.md` § What it does, change the "Control flow" bullet to end: "…with workflow-level default actions and parameters, and action `parameters` as the inputs of a `goto` or `retry` workflow target."
14. In `specs/roadmap.md`, append ` ✅` (a single space followed by U+2705) to the `## Phase 12 — Runner Arazzo 1.1.0 input channel and criterion semantics` heading, and leave the rest of the block untouched.

## Group 4 — Verify

Run every command after `source ~/.nvm/nvm.sh && nvm use`, from the repo root unless a `cd` is shown.

15. `cd packages/runner && npm test` exits 0. The 15 `action parameters` titles from item 9 and the item 10 title appear in the passing list, along with the existing `transfer to a workflow`, `retry reference` and `StepRetryRunner` suites.
16. `git diff --exit-code main -- packages/runner/test/fixtures/workflow-control-flow.arazzo.yaml` exits 0, so the existing 1.0.x control-flow fixture is unchanged.
17. `cd packages/runner && npm run typescript:check-types` exits 0.
18. `cd packages/runner && npm run typescript:declaration > "${TMPDIR:-/tmp}/runner-declaration.log" 2>&1` exits 0, and `grep -c "Warning:" "${TMPDIR:-/tmp}/runner-declaration.log" || true` prints the same count as on `main`. Take that baseline before Group 1, with the same two commands.
19. `npm run lint` exits 0.
20. Grep the docs and comments:
    - `grep -cE "It runs with no inputs|issue \`#62\`\)\.|then run with no inputs" packages/runner/src/executor/WorkflowExecutor.ts` prints `0`;
    - `grep -cF "Action \`parameters\` feed referenced workflows." specs/tech-stack.md` prints `1`;
    - `grep -cF "action \`parameters\` as the inputs of a \`goto\` or \`retry\` workflow target" packages/runner/README.md` prints `1`.
21. `grep -F "## Phase 12 — Runner Arazzo 1.1.0 input channel and criterion semantics ✅" specs/roadmap.md` exits 0, and `git diff main -- specs/roadmap.md` shows that heading line as the only change.
