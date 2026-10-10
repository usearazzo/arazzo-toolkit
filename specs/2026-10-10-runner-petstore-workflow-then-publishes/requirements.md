# Phase 5 Requirements — Runner runs the official petstore workflow, then publishes

## Scope

The runner proves it runs real Arazzo workflows against a real petstore, then becomes publishable. An end-to-end suite, opt-in for local development (`npm run test:e2e`, never part of `npm test`), runs two workflows over live HTTP against a `swaggerapi/petstore3:1.0.28` container: the toolkit's own `petstore-order-workflow.arazzo.yaml` and the Arazzo Specification's official petstore example, `LoginAndRetrievePets.arazzo.yaml` (#106). The suite stays out of the deterministic `npm test`; CI runs it in its own `build.yml` job against a petstore3 service container.

Whatever the live runs surface is fixed. Two runner defects are already known from probing both workflows against petstore3: a step or workflow output that is not a valid runtime expression silently becomes a literal string, and a malformed `operationPath` is reported as the wrong error. With the suite green, `@usearazzo/runner` drops `"private": true`, aligns its version with the rest of the monorepo, is confirmed to be picked up by the release workflow, and both READMEs describe it as an alpha package.

## Out of Scope

- Checking a document for authoring errors before the first request (a pre-run check or dry run). Authoring errors stay thrown when the faulty step runs; catching them before a run is the validator's job, and a validate-then-run command belongs to the CLI (#84).
- New validator rules. The rules these runs suggested are tracked in #197.
- Running the official `pet-coupons` example live: no petstore serves its `/pet/{petId}/coupons` endpoint. It stays a stub-transport regression test.
- The website reference page for the runner (a 1.0.0 GA gate, not a publishing gate).
- The npm publish itself. The first release is a manual maintainer step after merge, as it was for the CLI.

## Decisions

### The official example is LoginAndRetrievePets
"The official Arazzo Specification petstore example" (#106) is `examples/1.0.0/LoginAndRetrievePets.arazzo.yaml`, the specification's example built on the real swagger-petstore API (`loginUser`, `findPetsByStatus`). Our fixture copy corrects one authoring mistake: its `operationPath` points at a Path Item (`#/paths/~1pet~1findByStatus`) instead of an operation, so the copy appends `/get`, which is how the specification's own prose example writes it. The copy's header records the change, as `pet-coupons.arazzo.yaml` does. `pet-coupons` was considered and rejected for the live suite because its coupons endpoint exists only in its own OpenAPI description.

### Live target is a local petstore3 container
The suite runs against `swaggerapi/petstore3:1.0.28` (the newest versioned tag) in Docker, started and stopped by the suite on a Docker-assigned port, with a readiness wait and cleanup on failure or interruption; `PETSTORE_URL` points it at an existing instance instead. It is a real petstore over real HTTP, and reproducible. The public `petstore3.swagger.io` was rejected as the target: its whole `/store` section returned 500 during research (including `GET /store/inventory`), and `petstore-order-workflow` places orders. Probing a local container confirmed `loginUser`, `findPetsByStatus`, `placeOrder` and `getInventory` all answer 200.

### CI runs the suite against a service container
`build.yml` gains a separate `e2e` job that runs `npm run test:e2e` on every push and pull request to `main` (the roadmap's "opt-in" is about `npm test`, which stays untouched), against a GitHub Actions service container (`services: petstore`, the same pinned tag, with a `wget`-based health check since the image ships no `curl`) with `PETSTORE_URL` pointing at it, so the suite starts no container of its own there. Like the `test` job, it builds the workspace (`npm run build:es` at the root) first, because the runner imports the parser and resolver through their build output. A pinned image keeps the job deterministic, which is the roadmap's concern for `build.yml`, and keeps the publishing gate green on every change instead of only when someone runs it locally. The existing `test` job is untouched. The nightly workflow was considered and rejected: a regression would surface up to a day late and pull requests would not be gated.

### petstore-order-workflow is our fixture copy, made validator-clean
The suite runs `packages/runner/test/fixtures/petstore-order-workflow.arazzo.yaml`. Its sibling `petstore-order-workflow-3-1.arazzo.yaml`, used by other unit tests, has the same defects and gets the same fixes, or runner fix 1 would break those tests. The suite does not run the externally hosted copy at `arazzo-ui.jentic.com`, which has six validator errors and sends invalid values as literal text. Our copies are made clean: the two criterion `context: response` values become runtime expressions, `shipDate: $datetime.iso8601` (not an Arazzo expression, sent as the literal text `"$datetime.iso8601"` and rejected by the petstore with 400) is replaced by a real value from an input, and the dot-style simple conditions are checked against the criterion grammar and converted if invalid.

### Runner fixes are limited to what the runs surfaced
Per the roadmap ("anything it does not surface is not a gate"), only two runner changes are in scope, plus whatever the green-run effort surfaces later:

1. Fields whose specification type is `{expression}` — step and workflow `outputs`, and a criterion's `context` — must hold a valid runtime expression. Today `OutputResolver` applies the literal-vs-expression rule and turns `$response.body.id` (not valid Arazzo) into the string `"$response.body.id"`, which then flows into later requests; a `simple` criterion's `context` is ignored entirely. Both raise a typed error instead, matching the validator's diagnostics 9050804 and 9100201. `Any`-typed fields (parameter values, payload values, replacement values) keep accepting literals.
2. `OpenAPIOperationExecutor.execute` runs `OpenAPIOperationExtractor.extractByPointer`, which already resolves the pointer and requires an Operation Object, before deriving the operationId. A bad `operationPath` then raises the accurate `ExtractionError` ("does not reference an operation") instead of the `ClientError` from the earlier token-count check.

Errors stay raised when the faulty step runs. Checking every step before the first request was weighed and rejected: the suite passes without it, and the validator already reports these mistakes before a run.

## Constraints

- **One engine, no disagreement** (`specs/tech-stack.md`) — the validator and runner must agree on any document they both see. Runner fix 1 exists to restore that agreement for `{expression}`-typed fields.
- **Authoring errors throw, failed runs resolve** (`specs/tech-stack.md`, which names `ExecutionError`) — the new errors follow the same contract with the layer-specific classes the runner already uses for these fields (`ResolverError` for outputs, `CriterionError` for criteria, `ExtractionError` for operation locators), each with a named `reason`; a step that ran and failed its criteria stays a normal `failed` result.
- **The `HTTPClient` seam resolves for every HTTP status** (`specs/tech-stack.md`) — the suite drives the runner through `httpClientFetch`, the default transport, not a stub; non-2xx responses stay criterion outcomes.
- **Internal workspace pins track the published parser** (`specs/tech-stack.md`) — the runner's `@usearazzo/parser` and `@usearazzo/resolver` pins (now `1.0.1-alpha.7`) must name published versions at release time.
- **Deterministic CI** (roadmap Phase 5) — `npm test`, which `build.yml`'s `test` job runs, must not start containers or make network calls; the `e2e` job reaches only its pinned service container.
- **Documents stay ApiDOM** (`.claude/CLAUDE.md`) — the fixes work on ApiDOM elements and the existing parser grammar (`parseRuntimeExpression`), not on plain JSON.

## Context

The mission makes this the runner's only publishing gate: "the runner publishes the moment it runs the official petstore workflow end to end against a live petstore (#79, #106)" (`specs/mission.md` § Decisions). Recent work removed the gaps the official examples exposed under a stub transport: request payload expressions (#129, PR #227) and the meaning of `$outputs` and HTTP-exchange expressions in steps that call a workflow (#228, PR #230). Running the same workflows live was the remaining step, and probing it surfaced the two runner defects and the fixture mistakes above.

Publishing unblocks the post-publish runner phases (7, 8, 12) and the CLI's run command (Phase 11). The runner README's warning that the package "is not yet published" and the root README's `-- Placeholder --` Runner section are replaced; see `packages/runner/README.md` and the Validator and CLI sections of the root `README.md` for the target shape.
