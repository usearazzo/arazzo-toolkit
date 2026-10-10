# Phase 5 Validation — Runner runs the official petstore workflow, then publishes

## Definition of Done

All of the following must be true before this branch is merged.

### 1. Both official workflows run end to end against a live petstore

```
cd packages/runner && npm run test:e2e
```

Exits 0. The Mocha output lists exactly two passing specs from `test/e2e/petstore.spec.mjs` and no spec from any other file: one for `authenticateAndOrderPet` (`test/fixtures/petstore-order-workflow.arazzo.yaml`) and one for `loginUserRetrievePet` (`test/e2e/fixtures/LoginAndRetrievePets.arazzo.yaml`). Each asserts `result.status === 'completed'` and non-empty workflow outputs. Requests go over real HTTP through `httpClientFetch` to a `swaggerapi/petstore3:1.0.28` container the suite started itself; no `HTTPClient` stub is involved. After the command exits, `docker ps --filter ancestor=swaggerapi/petstore3:1.0.28 -q` prints nothing.

### 2. The suite runs against another petstore when told to

```
docker run --rm -d --name ps3 -p 18080:8080 swaggerapi/petstore3:1.0.28
cd packages/runner && PETSTORE_URL=http://localhost:18080/api/v3 npm run test:e2e; echo "exit=$?"
docker ps --filter ancestor=swaggerapi/petstore3:1.0.28 --format '{{.Names}}'
docker stop ps3
```

Prints `exit=0`, and the `docker ps` line prints only `ps3`: the suite started no container of its own.

### 3. The suite fails clearly without a petstore

```
cd packages/runner && PETSTORE_URL=http://127.0.0.1:9/api/v3 npm run test:e2e; echo "exit=$?"
```

Prints a non-zero exit after the readiness wait, with a message naming the URL that never became ready, instead of per-spec connection errors.

### 4. CI runs the suite on every change

- `.github/workflows/build.yml` has an `e2e` job whose `services.petstore` uses `swaggerapi/petstore3:1.0.28` with a `--health-cmd` based on `wget`, runs `npm ci`, `npm run build:es` at the repository root, then `npm run test:e2e` in `packages/runner` with `PETSTORE_URL: http://localhost:8080/api/v3`.
- That check is green on this branch's pull request.
- `git diff main -- .github/workflows/build.yml` shows only the added `e2e` job; the existing `test` job is unchanged.

### 5. The deterministic suite stays deterministic

```
cd packages/runner && npm test 2>&1 | tee /tmp/phase5-npm-test.log; grep -c "petstore.spec\|authenticateAndOrderPet against\|loginUserRetrievePet against" /tmp/phase5-npm-test.log
grep -F '"test/e2e/**"' packages/runner/.mocharc.json
```

`npm test` exits 0; the first `grep -c` prints `0` (no e2e spec ran); the second `grep` exits 0.

### 6. Non-expression outputs and criterion contexts are errors

```
cd packages/runner && npm test -- --grep "OutputResolver|CriterionEvaluator"
```

Exits 0, and the output lists these new passing cases:

- an output `orderId: $response.body.id` throws `ResolverError` with `reason: 'invalid-expression'` and the output's name in the message, instead of resolving to the string `"$response.body.id"`;
- a non-string output value throws the same;
- a criterion with `type: simple` and `context: response` throws `CriterionError` with `reason: 'invalid-context'`, and so does the same `context` with `type: regex`.

### 7. A malformed operationPath reports the accurate error

```
cd packages/runner && npm test -- --grep "OpenAPIOperationExecutor|StepExecutor"
grep -rn "must be of form" packages/runner/src
```

The first command exits 0, and its output lists new passing cases in which a Path Item pointer (`/paths/~1pet~1findByStatus`) and a pointer to a nonexistent path each reject with `ExtractionError`, whose message says the pointer does not reference an operation. No test expects `ClientError` for a malformed `operationPath` any more. The `grep` prints nothing.

### 8. All three fixtures are validator-clean

```
for f in packages/runner/test/fixtures/petstore-order-workflow.arazzo.yaml \
         packages/runner/test/fixtures/petstore-order-workflow-3-1.arazzo.yaml \
         packages/runner/test/e2e/fixtures/LoginAndRetrievePets.arazzo.yaml; do
  node packages/cli/bin/usearazzo.mjs validate "$f"; echo "exit=$?"
done
```

Prints `exit=0` three times. Before this phase, the first two each reported two 9100201 errors (`context: response`). In both order-workflow fixtures, `grep -n 'datetime\|context: response'` prints nothing. The `LoginAndRetrievePets` copy's header comment names its two changes from the OAI original.

### 9. Lint, types and public surface

```
cd packages/runner && npm run lint && npm run typescript:check-types && npm run typescript:declaration
```

Exits 0, with no api-extractor warning beyond those on `main`.

### 10. The runner is publishable by the release workflow

```
grep -c '"private"' packages/runner/package.json
node -p "const p=require('./packages/runner/package.json'); [p.version, p.dependencies['@usearazzo/parser'], p.dependencies['@usearazzo/resolver']].join(' ')"
npx lerna ls
```

The `grep -c` prints `0`; the `node` line prints `1.0.1-alpha.7 1.0.1-alpha.7 1.0.1-alpha.7`; `npx lerna ls` lists `@usearazzo/runner` without `(PRIVATE)`. `lerna ls` lists exactly the non-private packages that `release.yml`'s `lerna version … --no-private` and `lerna publish from-package --no-private` act on, so the runner is in the next release.

### 11. Documentation matches the published state

```
grep -c "not yet published" packages/runner/README.md
grep -c "test:e2e" packages/runner/README.md
grep -c -- "-- Placeholder --" README.md
grep -n "runner. is marked private" .claude/CLAUDE.md
grep -n "no end-to-end suite against a live API\|1.0.1-alpha.6" specs/tech-stack.md
grep -c "e2e" .claude/rules/testing.md
```

Prints, in order: `0`; at least `1`; `0`; nothing; nothing; at least `1`. The runner README documents the `{expression}`-field errors (`invalid-expression`, `invalid-context`).

### 12. Roadmap phase marked complete

```
grep -F "## Phase 5 — Runner runs the official petstore workflow, then publishes ✅" specs/roadmap.md
```

Exits 0.

## Not Required

- The npm publish itself, the trusted-publisher registration, or a published alpha on npm: these are maintainer steps after merge.
- Running `pet-coupons` live; its stub-transport test stays as is.
- Any pre-run or dry-run validation of a whole document.
- New validator rules (#197).
- A website reference page for the runner.
