<h1 align="center">@usearazzo/runner</h1>

<p align="center">
  Runner for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> workflows:
  execute them step by step against the live APIs behind their <a href="https://spec.openapis.org/oas/latest.html">OpenAPI</a> source descriptions.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usearazzo/runner"><img src="https://img.shields.io/npm/v/@usearazzo/runner.svg" alt="npm version"></a>
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## What it does

An Arazzo document describes a multi-step API workflow: which operations to call, in what order, what to pass from one step to the next, and what counts as success. This package runs it.

It loads the workflow and the OpenAPI documents its source descriptions point at. For each step it builds a real HTTP request, sends it to the live API, checks the step's success criteria against the response, and follows the control flow the document declares. When the run ends, you get the workflow's outputs and a trace of every step: whether it passed, which action was picked, how many attempts it took, and how long it ran.

Use it to test an API flow end to end in CI, to drive a workflow from your own service, or to let an agent run a workflow instead of improvising the calls. It handles:

- **Steps.** Parameters and request bodies resolved from runtime expressions, `successCriteria` evaluated (`simple`, `regex`, `jsonpath`, `xpath`), `outputs` resolved from the response.
- **Control flow.** `goto`, `retry` (with `retryLimit`, `retryAfter`, and references), and `end`, as the specification defines them, with workflow-level default actions and parameters.
- **Composition.** Sub-workflow steps, `dependsOn` prerequisites, one-way transfer to another workflow, and workflows in other Arazzo documents.
- **Your HTTP stack.** Global `fetch` by default, or any client you plug in. Credentials go in through a request interceptor, since Arazzo is auth-agnostic.

## At a glance

A runner is four building blocks, composed bottom-up; `ArazzoRunner` composes them for you:

| Building block | Job |
|---|---|
| `DocumentRegistry` | Loads and caches the Arazzo document and its OpenAPI source descriptions. |
| `WorkflowExecutor` | Runs a workflow's steps, owns the run state, and acts on the control flow. |
| `StepExecutor` | Runs one step: finds its operation, resolves its inputs, evaluates its criteria and outputs. |
| `OpenAPIOperationExecutor` | Builds one HTTP request, sends it through the `HTTPClient`, and reads the response. |

<p align="center">
  <img alt="Runner architecture: WorkflowExecutor runs steps through StepExecutor, which runs OpenAPI operations through OpenAPIOperationExecutor and the HTTPClient; DocumentRegistry supplies documents to all three executors" src="https://raw.githubusercontent.com/usearazzo/arazzo-toolkit/main/packages/runner/assets/architecture.svg">
</p>

A step whose criteria go unmet is a result, not an error: the run resolves with `status: 'failed'`. Only a document that cannot be run as written, a request that cannot be built or sent, or a cancelled run throws.

## Installation

```sh
npm install @usearazzo/runner
```

Ships ESM and CommonJS builds with TypeScript declarations. Requires Node.js 20.10 or newer.

## Usage

The sample workflow logs a user in, finds a pet, orders it, and checks the order. The public Petstore rejects orders, so the session starts a local one for it to call:

<a href="https://usearazzo.com/runner/"><img alt="A terminal session: start a Petstore with Docker, open a Node.js REPL, paste code that builds a runner from @usearazzo/runner, and run the authenticateAndOrderPet workflow against the Petstore; all five steps pass and the status is completed" src="https://raw.githubusercontent.com/usearazzo/arazzo-toolkit/main/packages/runner/assets/run-demo.svg"></a>

<details>
<summary>Text version</summary>

```console
$ docker run --rm -d -p 8080:8080 swaggerapi/petstore3:1.0.28
e7d2c5a17eb5b5b8c316000c8987d5d4a6c2f93ba161c5bd6fb1cec26cfc9d9a
$ node
Welcome to Node.js v24.10.0.
Type ".help" for more information.
> .editor
// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel)
const { ArazzoRunner } = await import('@usearazzo/runner');

const runner = await ArazzoRunner.load(
  'https://usearazzo.com/assets/reference/runner/petstore-order.arazzo.yaml',
);
const result = await runner.execute('authenticateAndOrderPet', {
  inputs: { username: 'theUser', password: '12345', preferredPetStatus: 'available', orderQuantity: 1 },
  executeOptions: { server: 'http://localhost:8080/api/v3' },
});
result.steps.map((s) => `${s.successful ? '✓' : '✗'} ${s.stepId}`);

[
  '✓ loginUser',
  '✓ findAvailablePets',
  '✓ placeOrder',
  '✓ retrieveOrderedPetDetails',
  '✓ verifyOrderConfirmation'
]
> result.status
'completed'
```

</details>

In a script, the same run is a `load` and an `execute`. `ArazzoRunner` wires the four building blocks with their defaults:

```js
import { ArazzoRunner } from '@usearazzo/runner';

const runner = await ArazzoRunner.load(
  'https://usearazzo.com/assets/reference/runner/petstore-order.arazzo.yaml',
);

const result = await runner.execute('authenticateAndOrderPet', {
  inputs: { username: 'theUser', password: '12345', preferredPetStatus: 'available', orderQuantity: 1 },
  executeOptions: { server: 'http://localhost:8080/api/v3' },
});
```

`runner.document` and `runner.registry` are the loaded entry document and the registry holding its source descriptions; unless you pass one, every runner `load` returns has a registry of its own. `load` takes the seams of the building blocks it wires: `registry` (one registry backs one entry document, so loading a different document into it throws `InvalidEntryDocumentError`), `httpClient` and `requestInterceptor`, and the workflow executor's `maxSteps`, `maxWorkflowDepth`, `sleep` and `now`. To bind a runner to a document you already acquired, use `new ArazzoRunner({ document, registry })`; it throws `InvalidEntryDocumentError` unless `document` is the entry document of `registry`.

To add credentials, pass a `requestInterceptor`:

```js
const runner = await ArazzoRunner.load(uri, {
  requestInterceptor: async (request) => {
    request.headers.Authorization = `Bearer ${await acquireToken()}`;
  },
});
```

To send requests through another HTTP stack, replace the `httpClient`. It is a function from the built request to a WHATWG `Response`; here undici with a connection pool that global `fetch` cannot take:

```js
import { fetch, Agent } from 'undici';

const dispatcher = new Agent({ connections: 16, keepAliveTimeout: 60_000 });

const runner = await ArazzoRunner.load(uri, {
  httpClient: (request) => fetch(request.url, { ...request, dispatcher }),
});
```

The two combine: the interceptor changes the request, and the client sends it. Both are options of `OpenAPIOperationExecutor` too, for when you compose the building blocks yourself.

## Documentation

The example above is the happy path. Everything else is on [usearazzo.com](https://usearazzo.com/):

- **[UseArazzo Runner](https://usearazzo.com/runner/)** introduces the runner: what it handles and how it is built. Start here when you are deciding whether it fits.
- **[Runner API Reference](https://usearazzo.com/docs/runner/)** covers every building block: its options, the result and the step trace, control flow and composition rules, choosing the server, the HTTP client, cancellation, and every error. Start here when you know what you want to call.

## Supported versions

Arazzo documents:

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

OpenAPI documents, as source descriptions:

- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Part of the Arazzo Toolkit

`@usearazzo/runner` is the execution layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme), [@usearazzo/resolver](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/resolver#readme), [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme), and [@usearazzo/cli](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/cli#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
