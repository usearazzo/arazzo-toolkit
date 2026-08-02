# Arazzo Toolkit

A comprehensive JavaScript/TypeScript toolkit for **parsing**, **resolving**, **validating** and **running** [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) documents.

[![Build Status](https://github.com/usearazzo/arazzo-toolkit/actions/workflows/build.yml/badge.svg)](https://github.com/usearazzo/arazzo-toolkit/actions)
[![Dependabot enabled](https://badgen.net/badge/icon/dependabot?icon=dependabot&label)](https://docs.github.com/en/code-security/supply-chain-security/keeping-your-dependencies-updated-automatically)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-3.0-40c463.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/CODE_OF_CONDUCT.md)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/usearazzo/arazzo-toolkit/blob/HEAD/LICENSE)

**Supported Arazzo versions:**
- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)

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
| [@usearazzo/validator](./packages/validator) | Validator & Linter for Arazzo Documents |
| [@usearazzo/runner](./packages/runner) | Runner for Arazzo Workflows |

---

## CLI

-- Placeholder --

For complete documentation, see the [@usearazzo/CLI README](./packages/cli/README.md).

---

## Validator

-- Placeholder --

For complete documentation, see the [@usearazzo/validator README](./packages/validator/README.md).

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
