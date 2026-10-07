<h1 align="center">@usearazzo/cli</h1>

<p align="center">
  Command-line interface for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> documents:
  validate and lint from your terminal or CI/CD pipeline.
</p>

<p align="center">
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## What it does

This package puts the toolkit behind a single `usearazzo` binary. Its one command today is `validate`, a thin wrapper around [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme): it checks an Arazzo document, local file or remote URL, and prints every problem with the location that caused it.

## Installation

```sh
npm install --global @usearazzo/cli
```

Or run it without installing:

```sh
npx @usearazzo/cli validate adopt-a-pet.arazzo.yaml
```

Requires Node.js 20.10 or newer.

## Usage

```console
$ usearazzo validate adopt-a-pet.arazzo.yaml
adopt-a-pet.arazzo.yaml
  2:1-2:5      error    9010300  should always have a 'version'
  2:1-2:5      warning  9010101  Info 'description' should be present and non-empty string.
  2:1-2:5      hint     9010401  Info 'summary' is recommended to be present and a non-empty string.
  9:5-18:1     hint     9040203  Workflow 'summary' is recommended to be present and a non-empty string.
  12:9-18:1    warning  9050201  Step 'description' should be present and non-empty string.
  17:21-17:29  error    9070401  Success action "stepId" must reference an existing step in the same workflow.

✖ 6 problems (2 errors, 2 warnings, 2 hints)
```

The argument is a path, a `file:` URI, or an HTTP(S) URL. Relative source descriptions resolve against the document's location.

| Option | Description |
|---|---|
| `-f, --format <format>` | Output format: `stylish` (default) or `json` |
| `--json` | Shorthand for `--format json` |
| `-o, --output <file>` | Write the report to a file instead of stdout. Never the input document |
| `-c, --config <file>` | Configuration file. Defaults to the first [configuration file](#configuration-file) found in the current working directory |
| `--json-schema-validation` | Also run JSON Schema validation (off by default) |
| `--max-problems <n>` | Report at most `n` problems. The exit code still counts all of them |
| `--fail-severity <severity>` | Lowest severity that fails the run: `error` (default), `warning`, `info`, `hint` |

### Exit codes

- `0`: no problem at or above `--fail-severity`.
- `1`: at least one problem at or above `--fail-severity`, or the document, the configuration file, or the output file could not be read or written. The reason goes to stderr.

## Configuration file

`usearazzo` looks for a configuration file in the current working directory, the way Spectral looks for its ruleset. The first match among `.usearazzo.yaml`, `.usearazzo.yml`, `.usearazzo.json`, `usearazzo.yaml`, `usearazzo.yml` and `usearazzo.json` wins; parent directories are not searched. `--config` points at any other file, relative to the current working directory.

The file is YAML or JSON. Its `languageService` key is the [SpecLynx ApiDOM Language Service](https://www.npmjs.com/package/@speclynx/api-languageservice) context that `@usearazzo/validator` takes, deep-merged over the validator's defaults:

```yaml
languageService:
  validationContext:
    jsonSchemaValidation: true # default: false
    semanticValidation: true # default: true
    referenceValidation: true # default: true
    semanticLinting: true # default: true
  parseContext:
    arazzo:
      sourceDescriptionsResolution: true # fetch and parse source descriptions (default: true)
```

Command-line flags win over the configuration file, and the configuration file wins over the validator's defaults.

## Documentation

See the [@usearazzo/validator README](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme) for what is checked, and the [Validator API Reference](https://usearazzo.com/docs/validator/) for every diagnostic code and rule.

## Part of the Arazzo Toolkit

`@usearazzo/cli` is the command-line layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme), [@usearazzo/resolver](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/resolver#readme), [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme), and [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
