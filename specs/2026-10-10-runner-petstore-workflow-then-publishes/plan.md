# Phase 5 Plan — Runner runs the official petstore workflow, then publishes

## Group 1 — End-to-end suite, run red

1. Add `packages/runner/test/e2e/container.ts`, a Mocha root-hook plugin (`mochaHooks` with `beforeAll` / `afterAll`):
   - Without `PETSTORE_URL`, it fails fast with a clear message when the `docker` binary or daemon is unavailable (`docker info`), then starts `swaggerapi/petstore3:1.0.28` with `docker run --rm -d -p 127.0.0.1:0:8080`, reads the host port Docker assigned (`docker port <id> 8080`), and exposes `http://127.0.0.1:<port>/api/v3` to the specs. Docker picks a free port, so parallel runs do not collide.
   - With `PETSTORE_URL` set, it uses that instance and starts nothing.
   - In both cases it waits until `GET <base>/openapi.json` answers 200, polling for up to 120 s, and fails the run with the last error if the instance never becomes ready.
   - It stops a container it started in `afterAll`, and also on `SIGINT` / `SIGTERM` and when the readiness wait fails, so an interrupted run leaves nothing behind.
2. Add `packages/runner/.mocharc.e2e.json`: `spec` `test/e2e/**/*.spec.mjs`, `file` `test/mocha-bootstrap.mjs`, `require` `test/e2e/container.mjs`, `timeout` 180000 (the first `beforeAll` includes the image pull). Add `test/e2e/**` to the `ignore` list of `packages/runner/.mocharc.json` so `npm test` never loads the suite.
3. Add the `test:e2e` script to `packages/runner/package.json`: `npm run build:es`, transpile `test` with Babel exactly as `test` does, then `cross-env NODE_ENV=test mocha --config .mocharc.e2e.json`.
4. Add `packages/runner/test/e2e/fixtures/LoginAndRetrievePets.arazzo.yaml`, copied from OAI/Arazzo-Specification `examples/1.0.0/`, with its source description pointing at the existing `test/fixtures/petstore.openapi.json` (the petstore3 description) and `/get` appended to the `getPetStep` `operationPath`. A header comment lists both changes, like `test/fixtures/pet-coupons.arazzo.yaml`.
5. Make both `packages/runner/test/fixtures/petstore-order-workflow.arazzo.yaml` and its sibling `petstore-order-workflow-3-1.arazzo.yaml` validator-clean, since they share the same defects (`context: response` at lines 75 and 98, `shipDate: $datetime.iso8601` at line 92):
   - replace both `context: response` values with runtime expressions;
   - replace `shipDate: $datetime.iso8601` with `$inputs.shipDate` and declare `shipDate` in the workflow's `inputs` schema;
   - check the simple conditions `$response.body && $response.body.length > 0` and `$response.body.id != null` against `parseCriterionCondition` from `@usearazzo/parser`, and rewrite them in JSON Pointer form if they do not parse;
   - update every test that uses these fixtures (`test/executor/StepExecutor.ts`, `test/executor/OpenAPIOperationExecutor.ts`, `test/assembler/OpenAPI2DocumentAssembler.ts`, `test/assembler/OpenAPI31DocumentAssembler.ts`, `test/normalizer/OpenAPI2OperationNormalizer.ts`, `test/normalizer/OpenAPI31OperationNormalizer.ts` and any others `grep -rln petstore-order-workflow test` finds) where it asserts on the changed values.
6. Add `packages/runner/test/e2e/petstore.spec.ts`, specs that run through `WorkflowExecutor` with the default `httpClientFetch` and `executeOptions.server` set to the instance from task 1: `authenticateAndOrderPet` from `petstore-order-workflow.arazzo.yaml` (with a `shipDate` input), and `loginUserRetrievePet` from `LoginAndRetrievePets.arazzo.yaml`. Each asserts `status: 'completed'` and its non-empty workflow outputs.
7. Run `npm run test:e2e` and record which steps fail and why. These failures drive Group 2.

## Group 2 — Runner fixes

8. In `packages/runner/src/resolver/OutputResolver.ts`, reject a step or workflow output value that is not a valid runtime expression (a non-string, or a string `parseRuntimeExpression` rejects) with `ResolverError`, `reason: 'invalid-expression'`, naming the output and the step or workflow. Outputs that are valid expressions resolve as today.
9. In `packages/runner/src/criterion/CriterionEvaluator.ts`, reject a present `context` that is not a valid runtime expression for every criterion type, including `simple`, where `context` is otherwise unused, with `CriterionError`, `reason: 'invalid-context'`. That reason already exists in `XPathCriterionEvaluator`; reuse it.
10. In `packages/runner/src/executor/OpenAPIOperationExecutor.ts`, call `OpenAPIOperationExtractor.extractByPointer` first in `execute()`, and derive the legacy operationId for `buildRequest` from the `path` / `http-method` metadata `extractByPointer` sets on the extracted operation; remove the pointer parsing and `ClientError` from `#operationIdFor`.
11. Update the existing tests that assert the old error for a malformed `operationPath` (`ClientError`, "Invalid operationPath" / "must be of form") in `test/executor/OpenAPIOperationExecutor.ts` and `test/executor/StepExecutor.ts` to expect `ExtractionError`, and add unit tests:
    - `test/resolver/OutputResolver.ts`: an invalid-expression output and a non-string output throw with `reason: 'invalid-expression'`; valid ones resolve;
    - `test/criterion/CriterionEvaluator.ts`: an invalid `context` throws `reason: 'invalid-context'` for `simple` and for `regex`;
    - `test/executor/OpenAPIOperationExecutor.ts`: a Path Item pointer and a pointer to a nonexistent path reject with `ExtractionError`.
12. Fix anything else the Group 1 run surfaced, each with a unit test, until `npm run test:e2e` passes.
13. Document the `{expression}`-field errors in `packages/runner/README.md` next to the existing authoring-error documentation.

## Group 3 — Publish prep, CI and docs

14. In `packages/runner/package.json`, remove `"private": true` and set `"version"` to `1.0.1-alpha.7` (the `lerna.json` version, as `@usearazzo/cli` is); confirm the `@usearazzo/parser` and `@usearazzo/resolver` pins are `1.0.1-alpha.7`. `release.yml` runs `lerna version … --no-private` and `lerna publish from-package --no-private`, so a package `lerna ls` lists is one the release workflow publishes; confirm the runner appears there.
15. Replace the WARNING block at the top of `packages/runner/README.md` with an alpha-channel note (published under the alpha channel; APIs may change before 1.0.0), and add an "End-to-end tests" note documenting `npm run test:e2e`, Docker, and `PETSTORE_URL`.
16. Replace the `-- Placeholder --` in the root `README.md` `## Runner` section with a short section in the shape of the Validator section: one sentence, `npm install @usearazzo/runner`, a minimal `WorkflowExecutor` example, and a link to the package README.
17. Add an `e2e` job to `.github/workflows/build.yml`:
    - `services: petstore` with `image: swaggerapi/petstore3:1.0.28`, `ports: ['8080:8080']`, and a health check (`options: --health-cmd "wget -q -O /dev/null http://localhost:8080/api/v3/openapi.json" --health-interval 5s --health-retries 24`; the image ships `wget` but not `curl`) so the job starts only once the petstore is ready;
    - the same Node setup as the other jobs, then `npm ci`, then `npm run build:es` at the repository root (the runner imports `@usearazzo/parser` and `@usearazzo/resolver` through their gitignored `src/index.mjs`, as the `test` job does);
    - `npm run test:e2e` in `packages/runner` with `PETSTORE_URL: http://localhost:8080/api/v3`. The suite's own readiness wait (task 1) still runs against it.
18. Update `specs/tech-stack.md`: the runner's publish status and the stale `1.0.1-alpha.6` (§ Architecture Summary "Current maturity"), and "no end-to-end suite against a live API" (§ Testing). Update `.claude/CLAUDE.md` ("`runner` is marked private and skipped on publish"), and list the new `e2e` job in the CI paragraph of `.claude/rules/testing.md`.
19. Append ` ✅` (a single space followed by U+2705) to the `## Phase 5 — Runner runs the official petstore workflow, then publishes` heading in `specs/roadmap.md`, leaving the rest of the block untouched.

## Group 4 — Verify

20. `cd packages/runner && npm run test:e2e` exits 0; the Mocha output lists exactly the two `test/e2e/petstore.spec.mjs` specs, both passing, and no other spec file.
21. `cd packages/runner && npm test` exits 0 and its output contains no `test/e2e` spec title; `grep -F '"test/e2e/**"' packages/runner/.mocharc.json` exits 0.
22. `cd packages/runner && npm run lint && npm run typescript:check-types && npm run typescript:declaration` exits 0 with no new api-extractor warnings.
23. `npx lerna ls` from the repository root lists `@usearazzo/runner` (without `(PRIVATE)`), and `node -p "require('./packages/runner/package.json').version"` prints `1.0.1-alpha.7`.
24. `node packages/cli/bin/usearazzo.mjs validate <file>` exits 0 for each of `packages/runner/test/fixtures/petstore-order-workflow.arazzo.yaml`, `packages/runner/test/fixtures/petstore-order-workflow-3-1.arazzo.yaml` and `packages/runner/test/e2e/fixtures/LoginAndRetrievePets.arazzo.yaml`.
25. The pull request's `e2e` check in `build.yml` passes, and `git diff main -- .github/workflows/build.yml` shows the `test` job unchanged.
26. `grep -F "## Phase 5 — Runner runs the official petstore workflow, then publishes ✅" specs/roadmap.md` exits 0.
