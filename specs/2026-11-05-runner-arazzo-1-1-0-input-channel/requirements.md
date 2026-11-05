# Phase 12 Requirements — Runner Arazzo 1.1.0 input channel and criterion semantics

## Scope

The runner honors Arazzo 1.1.0's `parameters` on Success and Failure Action Objects (#115):

- A `goto` action that names a `workflowId` passes its `parameters` to the workflow it transfers to, as that workflow's inputs.
- A `retry` action that names a `workflowId` passes its `parameters` to the repair workflow it runs before each new attempt.

Both targets ran with `{}` inputs until now, which is the gap #62 recorded for 1.0.x.

The values are resolved at the point where the action is taken. They read what the step that chose the action just saw: its response, its request, and the outputs it just produced. This applies to every 1.x document.

Of the three Phase 12 roadmap bullets, this is the only open work:
- Criterion evaluation errors (#120) already shipped in #301 and #302.
- The version-tagging bullet is superseded by #119.

## Out of Scope

- The `dependsOn` half of #62. Arazzo 1.1.0 gives workflow-level `dependsOn` no input mechanism either, so `dependencyInputs` stays the only channel.
- Selector Objects as parameter values (#123). An action parameter's `value` is a literal or a runtime expression, as for step parameters today.
- Validating what a target receives against its `inputs` JSON Schema (#97).
- A validator rule for `in` on an action parameter. It is filed as a rule idea on #197 (the validator's tracking issue for new rules) and lands in `@speclynx/api-languageservice`, not here.
- Changes to the `usearazzo/website` docs. The PR lists the edits; they land after the npm release that ships this change (`.claude/rules/website-docs-sync.md`).

## Decisions

### Resolve in the action's own context, plus the step's fresh outputs

An action's `parameters` resolve against the runtime-expression context its `criteria` were evaluated in, plus `$steps.<stepId>.outputs` holding the outputs this attempt just resolved.

- For an operation step, that context includes `$statusCode`, `$response.*`, `$request.*`, `$url`, `$method`, `$inputs`, earlier `$steps` and `$workflows`.
- For a step that calls a workflow, it includes `$outputs` and `$workflows` from the called run.

The outputs come from the attempt itself, not from run state. State is written only after the retry chain settles (`WorkflowExecutor.ts`, `state.setStepOutputs` after `#retryRunner.run`), so mid-chain it can still hold an earlier run's value.

Being able to read `$steps.<stepId>` is our own addition. The spec names no context for action parameters, and action `criteria` do not see it.

Why: the spec makes the values "passed to a workflow as referenced by `workflowId`" by the action, so they belong to the step outcome the action responds to. Two examples of what a user running the document expects:
- `goto handleError` with `value: $statusCode` passes this step's status code.
- `value: $steps.<thisStep>.outputs.id` passes the id the step just produced.

Consequences:
- The values resolve against the calling invocation's document, so its `$components` apply, never the target's.
- On a step that calls a workflow, an HTTP-exchange expression (`$statusCode`, `$response.*`, …) throws `RuntimeExpressionError` `unavailable-expression`. That matches that step's `outputs`; an action criterion would swallow the same error.

### The action context is a public field of the step result

Each attempt carries its action context on `StepAttemptOutcome` (`@internal`) as `actionContext`. Because the operation path returns `StepExecutionResult` (`@public`) directly as that outcome, the public type carries the field too, as a deliberate addition with TSDoc.

That exposes no new data class: `StepExecutionResult` already carries the full `response`. It also lets a tool builder who drives `StepExecutor` directly resolve action parameters the same way the workflow executor does. The alternative, wrapping every operation attempt in `WorkflowExecutor` to strip the field, would have to rebuild the post-request context outside `StepExecutor`, duplicating its request/response context builders.

### Resolved per firing, only for the action that fires

A `retry` reference's `parameters` are resolved again every time the retry fires, against the attempt that just failed. That includes any state a previous firing's repair recorded, the way a sub-workflow step's own `parameters` are re-read each attempt. A `goto` transfer resolves once, when it fires. Actions that matched but did not fire are never resolved, so a broken parameter on an action that is never taken cannot fail the run.

The failed attempt's context is gone by the time `StepRetryRunner` fires the reference after its `retryAfter` wait, so the runner hands that attempt's outcome to `runReference`. Inputs are resolved before the reference's budget unit is charged, so an authoring error in them costs no budget.

### `parameters` without a `workflowId` are ignored

`parameters` on an action that names no `workflowId` are never read, and the run is unaffected. That covers an `end`, a `goto` to a `stepId`, and a `retry` with no reference or with a `stepId` reference.

The validator reports this case as a **Warning** (`successAction|failureAction/lint/parameters--only-workflow-id`). Across the runner, an action field the validator only warns about is ignored, as `retryLimit` on a non-retry action is, while what it calls an Error makes the runner throw. Following that keeps the two in agreement, as `specs/tech-stack.md` requires ("The validator and runner must agree on any document they both see"). Throwing up front, or when the action fires, were both considered and rejected.

### An inline `in` throws when the action fires

An `in` written inline on an action parameter throws `ResolverError` with the new reason `ResolverError.ActionParameterLocation` (`'action-parameter-location'`) when that action fires. The error carries the `workflowId`, the `stepId` and `target: 'parameters'`. The rule comes straight from the spec: both action objects say "The `in` field MUST NOT be used."

An `in` that arrives through a `$components.parameters` Reusable Object is ignored, and the parameter maps by `name`, as `WorkflowParameterResolver` already does for a step that calls a workflow. Reason: a shared component has to carry `in` for operation steps, and the Parameter Object's `in` row says that when an action specifies a `workflowId`, "all parameters map to workflow inputs".

After dereferencing, a reusable parameter is a `ParameterElement` too. The dereferencer marks it with `ref-fields` / `ref-type` metadata (`@speclynx/apidom-reference` `dereference/strategies/arazzo-1/visitor.mjs`), so a parameter counts as inline only when it has an `in` key and no `ref-fields` metadata.

The check runs when the action fires, for the same reasons the values resolve then. The matching validator rule is the #197 idea.

### Only the action's own parameters reach the target

The target gets the action's own `parameters`, mapped by `name` to inputs:
- The first entry wins on a duplicate name, as in `WorkflowParameterResolver`.
- A `parameters` that is present but not a list throws `ResolverError` `malformed-parameters`, which the resolver already does.
- `parameters: []` counts as present and resolves to `{}`.

Workflow-level `parameters` are not inherited into actions, because the spec makes them "applicable for all steps". An action with a `workflowId` and no `parameters` keeps running its target with `{}`. The caller's `$inputs` are not forwarded implicitly: they are inputs of a different workflow, and an author cannot see the forwarding in the document.

### Record the inputs a retry reference ran with

- **Retry reference with `parameters`** (including `[]`): `$workflows.<id>.inputs` records the inputs the reference actually received.
- **Retry reference without `parameters`:** keeps today's behavior. Inputs an earlier caller recorded are preserved, otherwise `{}`, for the reason `WorkflowExecutor.#retryReference`'s TSDoc gives.
- **`goto` transfer:** writes nothing to the caller's `$workflows`. The calling run ends there, and only the target's own `$inputs` matter.

## Constraints

- **Authoring errors throw, failed runs resolve** (`specs/tech-stack.md`). The `in` error and `malformed-parameters` are typed, reason-carrying `ResolverError`s. A target that fails is still a `status` on the nested result, not a throw.
- **One engine, no disagreement** (`specs/tech-stack.md`). Validator and runner must agree on any document they both see, which shapes both the ignore decision and the `in` decision above.
- **Runner architecture contract** (`specs/tech-stack.md`). `WorkflowExecutor` stays the single writer of run state. The `$steps.<stepId>` overlay is a fresh context object, like `#inputContext`, never a write to `WorkflowExecutionState`. Collaborators stay constructor-bound.
- **Arazzo 1.x runs as the latest minor** (#119). There are no version branches: action `parameters` are honored in any document that has them, and the validator flags them in a 1.0.x document (`allowed-fields-1-0`).
- **Everything stays ApiDOM.** Action parameters are read through `SuccessActionElement.parameters` / `FailureActionElement.parameters` and the `@speclynx/apidom-ns-arazzo-1` predicates.
- **Public API is deliberate.** The new `ResolverError` reason and the `actionContext` field on `StepExecutionResult` carry TSDoc and pass `typescript:declaration`.

## Context

`goto` to a workflow (#66) and `retry` references (#63) shipped for Arazzo 1.0.x with `{}` inputs, because 1.0.x gives them no input mapping (#62). The `specs/tech-stack.md` invariant "Referenced workflows run with empty inputs in 1.0.x" names #115 as the channel that closes that gap. Without it, a transfer or repair workflow that needs anything from the step that triggered it can't be written in a document.

The runner README's § What it does "Control flow" bullet gains one clause. The detailed rules live on the website (`_reference/runner.md` § Retries and § Transfer), which today say a `workflowId` reference and a transfer target run "with no inputs", and change once this ships.
