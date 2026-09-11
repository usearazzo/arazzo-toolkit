# Phase [PHASE_NUMBER] Validation — [PHASE_TITLE]

## Definition of Done

All of the following must be true before this branch is merged.

### 1. [CHECK_TITLE]

```
[CONCRETE_COMMAND]
```

[EXACT_EXPECTATION — exit code, output substring, file contents. Be concrete: "`cd packages/runner && npm test -- --grep \"WorkflowExecutor\"` exits 0 and the new `it` title appears in the passing list" — not "runner works".]

### 2. [CHECK_TITLE]

```
[CONCRETE_COMMAND]
```

[EXACT_EXPECTATION.]

### 3. [CHECK_TITLE]

[DESCRIPTION_OF_CHECK — may or may not have a command. For file-contents assertions: "`packages/parser/package.json` must list `@speclynx/apidom-reference` with a `^` range matching the other `@speclynx/*` deps".]

## Not Required

- [WHAT_IS_EXPLICITLY_DEFERRED_TO_A_LATER_PHASE]
- [WHAT_NEED_NOT_BE_TESTED_IN_THIS_PHASE]
- [WHAT_IS_OUT_OF_SCOPE_FOR_VALIDATION]