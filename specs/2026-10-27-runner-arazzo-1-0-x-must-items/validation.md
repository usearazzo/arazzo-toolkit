# Phase 8 Validation — Runner Arazzo 1.0.x MUST items

## Definition of Done

All of the following must be true before this branch is merged. Checks 1, 2 and 6 apply to every one of the phase's pull requests, and checks 3–5 and 7–8 to the pull request of the issue they name. The phase is done when the last pull request merges.

### 1. Runner suite passes

```
cd packages/runner && npm test
```

Exits 0, and the specs added for the issue in that pull request (plan tasks 2–3, 7, or 9–10) appear in the passing list. Their titles are chosen so the `--grep` commands in checks 3, 4 and 7 select every one of them (plan tasks 2, 7, 9 and 10).

### 2. Types, lint and declarations are clean

```
cd packages/runner && npx tsc --noEmit -p tsconfig.json && npx eslint src test && npm run typescript:declaration
```

Exits 0, and api-extractor reports no warnings. No export of `packages/runner/src/index.ts` changes, so the declaration rollup is unchanged apart from TSDoc text.

### 3. #126 — an undefined parameter location throws before any request

```
cd packages/runner && npm test -- --grep "invalid-location"
```

The specs pass and assert:
- `in: body` and `in: headers` reject with `ResolverError`, `reason: 'invalid-location'`, with `target` set to the parameter's name and a message naming both the parameter and the location it was given;
- this holds against an OpenAPI 3.x operation and against an OpenAPI 2.0 operation that declares an `in: body` parameter, and in both cases the stub `HTTPClient` has recorded no request;
- each of `path`, `query`, `header`, `cookie`, and `querystring` still resolves.

### 4. #127 — an unreadable `successCriteria` throws before any request

```
cd packages/runner && npm test -- --grep "malformed successCriteria"
```

The specs pass and assert:
- a step whose only `successCriteria` entry is not a Criterion Object, and a step mixing a readable and an unreadable entry, reject with `ResolverError`, `reason: 'malformed-criterion'`, `target: 'successCriteria'`;
- a `successCriteria` that is present but not a list rejects with `reason: 'malformed-criteria'`;
- in each case the stub `HTTPClient` has recorded no request. For a step that targets a `workflowId`, the sub-workflow's first request is not sent either;
- a step without `successCriteria` still succeeds on any received response.

### 5. Validator parity for every construct the runner now rejects

Run from `packages/validator`, with the document text inlined:

```js
import { validate, createTextDocument } from '@usearazzo/validator';
// one Arazzo 1.0.1 document per case: a step parameter `{ name: x, in: body }`,
// `successCriteria: [42]`, and `successCriteria: { condition: x }`
const diagnostics = await validate(createTextDocument('file:///tmp/p.arazzo.yaml', text), {
  validationContext: { sourceDescriptionsResolution: false },
});
```

Each case yields a diagnostic with `severity: 1` (Error): `in must be one of: 'path', 'query', 'header', 'cookie'` for `in: body`, and `successCriteria must be an array of Criterion Objects` for both `successCriteria` cases. (Confirmed against `main` on 2026-10-27. This check guards against either side drifting.)

### 6. Documentation matches the behavior

`usearazzo/website` `_reference/runner.md` is updated in the same change as each issue:
- #126: the parameter section lists the five accepted `in` values and says, in prose, that any other location throws `ResolverError` with `reason: 'invalid-location'`;
- #127: the page states, next to `successCriteria`, that an unreadable one throws `ResolverError` (`malformed-criteria` / `malformed-criterion`) before the step's request;
- #117: the "**Default actions replace.**" paragraph is replaced by one describing the merge by `name`, quoting "can be overridden at the step level but cannot be removed there", and stating that `[]` inherits every workflow action.

### 7. #117 — workflow default actions merge by `name`

```
cd packages/runner && npm test -- --grep "action inheritance|merged default actions"
```

The specs pass and assert, for both `onSuccess` and `onFailure`:
- a step action replaces the workflow action with the same `name`;
- workflow actions the step does not name follow the step's own, in workflow order;
- `onSuccess: []` yields every workflow action;
- success and failure merge independently;
- a duplicate `name` resolves first-wins, within the step's list and within the workflow's;
- an entry without a `name` keeps its place and is not appended twice;
- a step whose `onSuccess` / `onFailure` is present but not a list is left untouched;
- inherited entries are the workflow's own action elements, not copies (`assert.strictEqual`), so retry budgets keyed by element identity stay shared;
- normalizing the same workflow twice yields the same lists (no duplicated inherited actions);
- a `$components`-referenced action merges by its dereferenced `name`.

The run-level `WorkflowExecutor` spec shows a step's own failure action taking precedence and an inherited unconditional `end` still applying when the step's own action does not match.

### 8. Roadmap marked complete

```
grep -F "## Phase 8 — Runner Arazzo 1.0.x MUST items ✅" specs/roadmap.md
```

Exits 0 once the last of the three pull requests (#117) is merged. The rest of the Phase 8 block is unchanged.

## Not Required

- No change to `@usearazzo/validator`. It already reports both rejected constructs, and its missing `querystring` location is tracked in #281.
- No version-specific behavior or fixtures. The three rules read the same in 1.0.0, 1.0.1, and 1.1.0.
- No end-to-end (`npm run test:e2e`) changes. The petstore workflows use none of the affected constructs, and the existing CI `e2e` job stays green.
- No change to `packages/runner/README.md`. These behaviors are documented in the website reference, and no public export changes.
- No reporting channel for skipped or failed criteria (#231), and no change to criterion evaluation errors (#120, Phase 12).
