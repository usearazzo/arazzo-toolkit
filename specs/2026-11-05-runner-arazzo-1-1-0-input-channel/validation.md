# Phase 12 Validation — Runner Arazzo 1.1.0 input channel and criterion semantics

## Definition of Done

All of the following must be true before this branch is merged. Run every command after `source ~/.nvm/nvm.sh && nvm use`, from the repo root unless a `cd` is shown.

### 1. Action-parameter behavior is pinned by tests

```
cd packages/runner && npm test -- --grep "action parameters"
```

Exits 0, and the passing list shows the `WorkflowExecutor` › `action parameters` context with each of these titles. The tests run on `test/fixtures/action-parameters.arazzo.yaml` (`arazzo: "1.1.0"`) through a stub `HTTPClient`.

- `should pass a goto action's parameters to the transfer target as inputs`. The target's `$inputs` equal the action's `parameters` by name.
- `should resolve action parameters against the step's response and its own fresh outputs`. Values from `$statusCode`, `$response.body`, `$inputs` and `$steps.<thisStep>.outputs` match the stubbed response and the outputs this attempt resolved, not a value left by an earlier run of the step.
- `should resolve a retry reference's parameters again on every firing`. With `retryLimit: 2`, two repair runs receive inputs that differ, because the stubbed response differs per attempt.
- `should record a retry reference's resolved inputs under $workflows`. After the chain, `$workflows.<id>.inputs` equals the last firing's inputs.
- `should keep earlier recorded inputs for a retry reference without parameters`. Inputs recorded by an earlier call to the same workflow survive.
- `should map duplicate action parameter names first-wins`.
- `should resolve parameters: [] to empty inputs`. The target's `$inputs` are `{}` and `$workflows.<id>.inputs` records `{}`.
- `should throw malformed-parameters for a non-list action parameters`. Throws `ResolverError` with reason `malformed-parameters`.
- `should throw action-parameter-location for an inline in only when the action fires`. Throws `ResolverError` with reason `action-parameter-location`, carrying `workflowId`, `stepId` and `target: 'parameters'`, on the attempt where that action fires. The same document, with that action's criteria unmatched, completes.
- `should map a reusable parameter carrying in by name with its value override`. No error, and the override value arrives.
- `should resolve a reusable parameter nested in a components action`. Same result as the direct form.
- `should ignore parameters on an action without a workflowId`. For an `end`, a `goto` to a `stepId` and a `retry` with a `stepId` reference, the trace (`steps[].stepId`, `attempts`, `successful`) and `status` equal those of the same workflows with `parameters` removed. The fixture holds both variants.
- `should not resolve the parameters of an action that matched but did not fire`. A later matching action whose parameters would throw never does.
- `should run a workflowId action without parameters with empty inputs`. The target's `$inputs` are `{}`, and the caller's `$inputs` are not forwarded.
- `should throw unavailable-expression for $statusCode in an action parameter of a step calling a workflow`. Throws `RuntimeExpressionError` with reason `unavailable-expression`.

### 2. Cross-document action targets resolve against the calling document

```
cd packages/runner && npm test -- --grep "cross-document action target"
```

Exits 0, and `should resolve a cross-document action target's parameters against the calling document` appears in the passing list. Its `$components.parameters` value comes from the calling document.

### 3. Existing behavior unchanged

```
cd packages/runner && npm test
git diff --exit-code main -- packages/runner/test/fixtures/workflow-control-flow.arazzo.yaml
```

Both exit 0. The full runner suite passes, including the existing `transfer to a workflow`, `retry reference` and `StepRetryRunner` suites. The 1.0.x control-flow fixture those suites run on is untouched.

### 4. Type check and public surface

```
cd packages/runner && npm run typescript:check-types
cd packages/runner && npm run typescript:declaration > "${TMPDIR:-/tmp}/runner-declaration.log" 2>&1
grep -c "Warning:" "${TMPDIR:-/tmp}/runner-declaration.log" || true
```

The first two commands exit 0. That includes the declaration build, so a failed `tsc` or `api-extractor` run fails the check rather than hiding behind a pipe. The `grep` prints the same warning count as on `main`, taken the same way before the change. `api-extractor run -l` exits 0 even with warnings, so exit 0 alone does not prove the count; `|| true` keeps a zero count from reading as a failure. `ResolverError.ActionParameterLocation` and `StepExecutionResult.actionContext` appear in `packages/runner/types/` with their TSDoc.

### 5. Lint

```
npm run lint
```

Exits 0.

### 6. Constitution, README and comments updated

```
grep -cE "It runs with no inputs|issue \`#62\`\)\.|then run with no inputs" packages/runner/src/executor/WorkflowExecutor.ts
grep -cF "Action \`parameters\` feed referenced workflows." specs/tech-stack.md
grep -cF "action \`parameters\` as the inputs of a \`goto\` or \`retry\` workflow target" packages/runner/README.md
```

They print `0`, `1` and `1`. The `#62` citations for `dependsOn` stay; only the claims that `goto` / `retry` targets have no input channel go.

### 7. Website edits listed in the PR

The PR body has a `Website:` section listing the `usearazzo/website` `_reference/runner.md` edits, each with its new wording:

- § Retries: "A `workflowId` reference runs with no inputs" becomes: it receives its action's `parameters`.
- § Transfer: "The target runs with no inputs, because a `goto` carries no parameters" becomes: it receives its action's `parameters`.
- The error reasons list gains `action-parameter-location`.

### 8. Roadmap marked complete

```
grep -F "## Phase 12 — Runner Arazzo 1.1.0 input channel and criterion semantics ✅" specs/roadmap.md
git diff main -- specs/roadmap.md
```

The grep exits 0. The diff changes only that heading line.

## Not Required

- The opt-in petstore e2e suite (`npm run test:e2e`). The official petstore workflows declare no action `parameters`.
- Any change to `packages/validator`. The `in` rule idea is filed on #197 for `@speclynx/api-languageservice`. The unrelated duplicate-`workflowId` false positive is #327.
- Validating what a target receives against its input schema (#97).
- Selector Object parameter values (#123).
- Editing the `usearazzo/website` repo. The edits are listed in the PR and land after the release.
- Browser bundle checks (Phase 10).
