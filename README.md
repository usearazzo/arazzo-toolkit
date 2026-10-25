# Arazzo Toolkit

JavaScript/TypeScript libraries and a command-line tool for **parsing**, **resolving**, **validating**, and **running** [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) documents.

**[Website](https://usearazzo.com/)** · **[Docs](https://usearazzo.com/docs/)** · **[Discussions](https://github.com/orgs/usearazzo/discussions)** · **[Issues](https://github.com/usearazzo/arazzo-toolkit/issues)**

[![Build Status](https://github.com/usearazzo/arazzo-toolkit/actions/workflows/build.yml/badge.svg)](https://github.com/usearazzo/arazzo-toolkit/actions)
[![Dependabot enabled](https://badgen.net/badge/icon/dependabot?icon=dependabot&label)](https://docs.github.com/en/code-security/supply-chain-security/keeping-your-dependencies-updated-automatically)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-3.0-40c463.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/CODE_OF_CONDUCT.md)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/LICENSE)

## Packages

This monorepo contains the following packages:

| Package | Description |
|---------|-------------|
| [@usearazzo/cli](./packages/cli) | Command-line interface for the toolkit: validate Arazzo documents from the terminal and CI |
| [@usearazzo/validator](./packages/validator) | Validator and linter for Arazzo documents, reporting LSP diagnostics |
| [@usearazzo/runner](./packages/runner) | Runs Arazzo workflows step by step against live APIs, with a trace of every step |
| [@usearazzo/parser](./packages/parser) | Parser for Arazzo documents, producing the [SpecLynx ApiDOM](https://github.com/speclynx/apidom) data model. [API reference](https://usearazzo.com/docs/parser/) |
| [@usearazzo/resolver](./packages/resolver) | Dereferences, bundles, and resolves the references in Arazzo and OpenAPI documents. [API reference](https://usearazzo.com/docs/resolver/) |

---

## [CLI](./packages/cli)

`@usearazzo/cli` puts the toolkit behind a single `usearazzo` binary for your terminal or CI/CD pipeline. Its one command today is `validate`, which wraps `@usearazzo/validator` and exits non-zero when the document has errors. A command to run workflows, wrapping `@usearazzo/runner`, comes next.

```sh
npx @usearazzo/cli validate ./adopt-a-pet.arazzo.yaml
```

<a href="https://usearazzo.com/cli/"><img alt="usearazzo validate reporting two duplicate stepId errors in one Arazzo document and a missing step description warning in another, each with its line range and rule code" src="https://raw.githubusercontent.com/usearazzo/arazzo-toolkit/main/packages/cli/assets/validate-demo.svg"></a>

Settings for the validator can live in a YAML or JSON configuration file (`.usearazzo.yaml`, `.usearazzo.json`, and a few variants) in the working directory. See the [product page](https://usearazzo.com/cli/) for what it does and the [CLI reference](https://usearazzo.com/docs/cli/) for every option, output format, exit code, and the configuration file.

---

## [Validator](./packages/validator)

`@usearazzo/validator` checks an Arazzo document and reports every problem it finds as a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) diagnostic, with its location, severity, and rule code.

```sh
npm install @usearazzo/validator
```

```js
import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';

const diagnostics = await validateURI('./adopt-a-pet.arazzo.yaml');
const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
```

To validate from the terminal or CI without writing code, use the [CLI](#cli):

```sh
npx @usearazzo/cli validate ./adopt-a-pet.arazzo.yaml
```

See the [product page](https://usearazzo.com/validator/) for what it checks and the [API reference](https://usearazzo.com/docs/validator/) for every option, diagnostic code, and rule.

---

## [Runner](./packages/runner)

`@usearazzo/runner` runs an Arazzo workflow. For each step it sends a real HTTP request to the API its OpenAPI source description points at, checks the step's success criteria against the response, and follows the control flow the document declares: `goto`, `retry`, `end`, sub-workflows, and `dependsOn`. A run hands back the workflow's outputs and a trace of every step.

```sh
npm install @usearazzo/runner
```

Here it runs a workflow that logs in, finds a pet, orders it, and checks the order, against a local Petstore (the public one rejects orders):

<a href="https://usearazzo.com/runner/"><img alt="A terminal session: start a Petstore with Docker, open a Node.js REPL, paste code that builds a runner from @usearazzo/runner, and run the authenticateAndOrderPet workflow against the Petstore; all five steps pass and the status is completed" src="https://raw.githubusercontent.com/usearazzo/arazzo-toolkit/main/packages/runner/assets/run-demo.svg"></a>

<details>
<summary>Text version</summary>

```console
$ docker run --rm -d -p 8080:8080 swaggerapi/petstore3:1.0.28
4d570a52c1bcdb87286e5ceed5177b033cf54d1de70c5279b6db33a4f40f0f1c
$ node
Welcome to Node.js v24.10.0.
Type ".help" for more information.
> .editor
// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel)
const { DocumentRegistry, OpenAPIOperationExecutor, StepExecutor, WorkflowExecutor } =
  await import('@usearazzo/runner');

const registry = new DocumentRegistry();
const document = await registry.acquireEntryDocument(
  'https://usearazzo.com/assets/reference/runner/petstore-order.arazzo.yaml',
);
const operationExecutor = new OpenAPIOperationExecutor();
const stepExecutor = new StepExecutor({ document, registry, operationExecutor });
const executor = new WorkflowExecutor({ document, registry, stepExecutor });

const result = await executor.execute('authenticateAndOrderPet', {
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

`ArazzoRunner.load` and `execute` run a workflow in two calls, and its four building blocks stay public for composing your own. See the [product page](https://usearazzo.com/runner/) for what it handles and what comes next, and the [API reference](https://usearazzo.com/docs/runner/) for every option, result field, and error.

---

## Supported versions

Arazzo documents:

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

OpenAPI documents, as source descriptions:

- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Contributing

Please read our [Contributing Guide](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md) before submitting a pull request.

## Origins

Arazzo Toolkit was founded on [Jentic Arazzo Tools](https://github.com/jentic/jentic-arazzo-tools), Apache 2.0, from commit `c696c9`. The parser, resolver, and runner originate there and are developed further here. See [NOTICE](./NOTICE) for full attribution.

## License

This project is licensed under the [Apache 2.0 License](./LICENSE) and comes with an explicit [NOTICE](./NOTICE) file containing additional legal notices and information.
