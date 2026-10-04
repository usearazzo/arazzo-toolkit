<h1 align="center">@usearazzo/validator</h1>

<p align="center">
  Validator and linter for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> documents:
  semantic validation, semantic linting, and opt-in JSON Schema validation.
</p>

<p align="center">
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## What it does

This package checks an Arazzo document and reports every problem it finds as an LSP [Diagnostic](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnostic), ready for an editor, a CI step, or a CLI:

- **Semantic validation.** Required fields, field types, and allowed values, for each Arazzo object.
- **Semantic linting.** Cross-object rules: step and workflow IDs resolve, runtime expressions parse, `regex` criterion conditions compile, `$sourceDescriptions.` references point at a source of the right `type`.
- **Reference validation.** Local `$ref` pointers inside JSON Schema objects (`workflow.inputs`, `components.inputs`) resolve to an existing target.
- **JSON Schema validation, opt-in.** Structural checks from the Arazzo JSON Schema, such as `oneOf` discrimination for Reusable Objects. Off by default because it reports a second diagnostic for many problems the linting rules already catch.

## At a glance

| Function | Takes | Returns |
|---|---|---|
| `validateURI` | path, `file:` URI, or HTTP(S) URL | `Diagnostic[]` |
| `validate` | a [`TextDocument`](https://www.npmjs.com/package/vscode-languageserver-textdocument) already in memory | `Diagnostic[]` |
| `createTextDocument` | URI and content | a `TextDocument` ready for `validate` |

Problems in the document come back as diagnostics, never as thrown errors. `validateURI` throws `ValidateError` only when it cannot fetch the document (a missing file, an HTTP error, a disallowed location), with the underlying error on `cause`.

A relative path is read from the current working directory, just like with any Node.js file API.

## Installation

```sh
npm install @usearazzo/validator
```

Ships ESM and CommonJS builds with TypeScript declarations. Requires Node.js 20.10 or newer.

## Usage

```js
import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';

const diagnostics = await validateURI('./adopt-a-pet.arazzo.yaml');
const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
const isValid = errors.length === 0;
```

A URL works the same way, and relative source descriptions resolve against it:

```js
const diagnostics = await validateURI('https://example.com/adopt-a-pet.arazzo.yaml');
```

When the content is already in memory, wrap it in a `TextDocument` and call `validate`. Relative `sourceDescriptions[].url` entries resolve against the `TextDocument`'s URI, so give it the document's real, absolute location:

```js
import { validate, createTextDocument } from '@usearazzo/validator';

const textDocument = createTextDocument('file:///home/me/specs/adopt-a-pet.arazzo.yaml', yamlText);
const diagnostics = await validate(textDocument);
```

## Options

Both functions take a [SpecLynx ApiDOM Language Service](https://www.npmjs.com/package/@speclynx/api-languageservice) context as their second argument, deep-merged over `defaultLanguageServiceContext`:

```js
const diagnostics = await validateURI('./adopt-a-pet.arazzo.yaml', {
  validationContext: {
    jsonSchemaValidation: true, // default: false
    semanticValidation: true, // default: true
    referenceValidation: true, // default: true
    semanticLinting: true, // default: true
    betterAjvErrors: true, // default: true
  },
  parseContext: {
    fileAllowList: [/\.json$/i, /\.ya?ml$/i], // local files source descriptions may read (default)
    arazzo: {
      sourceDescriptionsResolution: true, // fetch and parse source descriptions (default: true)
    },
  },
});
```

`validateURI` takes a third argument, the [ApiDOM Reference resolve options](https://github.com/speclynx/apidom/blob/main/packages/apidom-reference/src/options/index.ts) used to fetch the entry document. They default to `@usearazzo/parser`'s file and HTTP resolvers, exported as `defaultArazzoResolveOptions`:

```js
const diagnostics = await validateURI('https://example.com/adopt-a-pet.arazzo.yaml', {}, {
  resolverOpts: { timeout: 10000 },
});
```

### Untrusted documents

By default the validator reads only local `.json`, `.yaml`, and `.yml` files (dotfiles included) for the entry document and for source descriptions, but it does fetch every source description, local or remote. To validate a document you don't trust without touching the file system or the network beyond the document itself:

```js
const diagnostics = await validateURI('./untrusted.arazzo.yaml', {
  parseContext: {
    fileAllowList: [],
    arazzo: { sourceDescriptionsResolution: false },
  },
});
```

## Supported versions

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

## Part of the Arazzo Toolkit

`@usearazzo/validator` is the checking layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme), [@usearazzo/resolver](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/resolver#readme), and [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
