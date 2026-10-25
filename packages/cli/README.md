<h1 align="center">@usearazzo/cli</h1>

<p align="center">
  Command-line interface for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> documents:
  validate and lint from your terminal or CI/CD pipeline.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usearazzo/cli"><img src="https://img.shields.io/npm/v/@usearazzo/cli.svg" alt="npm version"></a>
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## Get started

Validate an Arazzo document. Nothing to install:

```sh
npx @usearazzo/cli validate adopt-a-pet.arazzo.yaml
```

<a href="https://usearazzo.com/cli/"><img alt="usearazzo validate reporting two duplicate stepId errors in one Arazzo document and a missing step description warning in another, each with its line range and rule code" src="https://raw.githubusercontent.com/usearazzo/arazzo-toolkit/main/packages/cli/assets/validate-demo.svg"></a>

The argument is a path, a `file:` URI, or an HTTP(S) URL. Every problem comes with the line range that caused it and the code of the rule it broke.

Prefer a global install?

```sh
npm install --global @usearazzo/cli
usearazzo --help
```

Requires Node.js 20.10 or newer.

## Commands

| Command | What it does |
| :------ | :----------- |
| [`validate`](https://usearazzo.com/docs/cli/#validate) | Validate and lint an Arazzo 1.0.x or 1.1.0 document, from a file or a URL. Wraps [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme). |

Built for CI: the exit code gates on a severity you choose (`--fail-severity`), and problems are available as JSON (`--format json`). Settings can live in a `.usearazzo.yaml` or `.usearazzo.json` file in the working directory.

A command to run workflows, wrapping [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme), comes next.

## Documentation

Every option is documented on [usearazzo.com](https://usearazzo.com/) and in `usearazzo <command> --help`:

- **[UseArazzo CLI](https://usearazzo.com/cli/)** introduces the CLI: what it does in a terminal and in CI, and the commands that come next. Start here when you are deciding whether it fits.
- **[CLI Reference](https://usearazzo.com/docs/cli/)** covers every command and option, both output formats, the exit codes, the configuration file, and running in CI. Start here when you know what you want to run.

## Part of the Arazzo Toolkit

`@usearazzo/cli` is the command-line layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme), [@usearazzo/resolver](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/resolver#readme), [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme), and [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
