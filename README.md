# Arazzo Toolkit

A comprehensive JavaScript/TypeScript toolkit for **parsing**, **resolving**, **validating** and **running** [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) documents.

[![Build Status](https://github.com/usearazzo/arazzo-toolkit/actions/workflows/build.yml/badge.svg)](https://github.com/usearazzo/arazzo-toolkit/actions)
[![Dependabot enabled](https://badgen.net/badge/icon/dependabot?icon=dependabot&label)](https://docs.github.com/en/code-security/supply-chain-security/keeping-your-dependencies-updated-automatically)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-3.0-40c463.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/CODE_OF_CONDUCT.md)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/LICENSE)

**Supported Arazzo versions:**
- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

**Supported OpenAPI versions (for source descriptions):**
- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Packages

This monorepo contains the following packages:

| Package | Description |
|---------|-------------|
| [@usearazzo/parser](./packages/parser) | Parser for Arazzo Documents producing [SpecLynx ApiDOM](https://github.com/speclynx/apidom) data model |
| [@usearazzo/resolver](./packages/resolver) | Resolver for Arazzo Documents |
| [@usearazzo/validator](./packages/validator) | Validator and linter for Arazzo documents, reporting LSP diagnostics |
| [@usearazzo/runner](./packages/runner) | Runner for Arazzo Workflows |
| [@usearazzo/cli](./packages/cli) | Command-line interface for Arazzo documents |

---

## CLI

`@usearazzo/cli` puts the toolkit behind a single `usearazzo` binary for your terminal or CI/CD pipeline. Its one command today is `validate`, which wraps `@usearazzo/validator` and exits non-zero when the document has errors. It is not on npm yet; from a clone of this repository, after `npm install` and `npm run build:es`:

```sh
npx usearazzo validate ./adopt-a-pet.arazzo.yaml
```

Settings for the validator can live in a YAML or JSON configuration file (`.usearazzo.yaml`, `.usearazzo.json`, and a few variants) in the working directory. See the [@usearazzo/cli README](./packages/cli/README.md) for every option, the exit codes, and the configuration file.

---

## Validator

`@usearazzo/validator` checks an Arazzo document and reports every problem it finds as a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) diagnostic, with its location, severity, and rule code.

```sh
npm install @usearazzo/validator
```

```js
import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';

const diagnostics = await validateURI('./adopt-a-pet.arazzo.yaml');
const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
```

See the [product page](https://usearazzo.com/validator/) for what it checks, the [@usearazzo/validator README](./packages/validator/README.md) for an overview, and the [API reference](https://usearazzo.com/docs/validator/) for every option, diagnostic code, and rule.

---

## Runner

-- Placeholder --

For complete documentation, see the [@usearazzo/runner README](./packages/runner/README.md).

---

## Contributing

Please read our [Contributing Guide](./CONTRIBUTING.md) and [Code of Conduct](./CODE_OF_CONDUCT.md) before submitting a pull request.

## Origins

Arazzo Toolkit was founded on [Jentic Arazzo Tools](https://github.com/jentic/jentic-arazzo-tools), Apache 2.0, from commit `c696c9`. The parser, resolver, and runner originate there and are developed further here. See [NOTICE](./NOTICE) for full attribution.

## License

This project is licensed under the [Apache 2.0 License](./LICENSE) and comes with an explicit [NOTICE](./NOTICE) file containing additional legal notices and information.
