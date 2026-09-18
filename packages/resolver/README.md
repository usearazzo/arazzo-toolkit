<h1 align="center">@usearazzo/resolver</h1>

<p align="center">
  Reference resolver for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> and <a href="https://spec.openapis.org/oas/latest.html">OpenAPI</a> documents:
  dereference, resolve, and bundle.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usearazzo/resolver"><img src="https://img.shields.io/npm/v/@usearazzo/resolver.svg" alt="npm version"></a>
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## What it does

An Arazzo document and the OpenAPI descriptions it points at form a graph of files joined by references. This package walks that graph three ways, all on [SpecLynx ApiDOM](https://github.com/speclynx/apidom):

- **Dereference.** `dereferenceArazzo` and `dereferenceOpenAPI` replace every reference with the content it points at: JSON References (`$ref`) and Reusable Object references (`$components.*`) in Arazzo; Reference Objects, Path Item references, and schema references in OpenAPI. The result is one self-contained tree. Arazzo source descriptions can be dereferenced along with the entry document.
- **Resolve.** `resolveArazzo` and `resolveOpenAPI` fetch the document and every external document its references reach, and return the `ReferenceSet` listing them all, parsed. Nothing is replaced; this is the reference graph itself.
- **Bundle.** `bundleArazzo` and `bundleOpenAPI` pull external documents into the entry document's components, producing a single compound document that still reads like the original. OpenAPI references are repointed to the hoisted component. External JSON Schema resources are embedded whole with their `$id`, under `components.inputs` in Arazzo and `components.schemas` in OpenAPI 3.1; when a resource declares its own `$id`, the referencing `$ref` is rewritten to that `$id` so it still resolves inside the bundle, and a resource without one gets an `$id` relative to the entry document with the `$ref` left as written.

## At a glance

| Function | Takes | Returns |
|---|---|---|
| `dereferenceArazzo` | Arazzo document: path or URL | `ParseResultElement` with every reference replaced inline |
| `dereferenceArazzoElement` | `ParseResultElement`, or a child element such as a `WorkflowElement` with its document in `dereference.strategyOpts.parseResult` | The same element kind, dereferenced |
| `dereferenceOpenAPI` | OpenAPI document: path or URL | `ParseResultElement` for OpenAPI 2.0, 3.0.x, or 3.1.x |
| `dereferenceOpenAPIElement` | `ParseResultElement`, or a child element such as a `PathItemElement` with its document in `dereference.strategyOpts.parseResult` | The same element kind, dereferenced |
| `resolveArazzo` | Arazzo document: path or URL | `ReferenceSet`, entry document as the root reference |
| `resolveArazzoElement` | `ParseResultElement`, or a child element with its document in `dereference.strategyOpts.parseResult` | `ReferenceSet`; for a child element the root reference wraps the child, not the entry document |
| `resolveOpenAPI` | OpenAPI document: path or URL | `ReferenceSet`, entry document as the root reference |
| `resolveOpenAPIElement` | `ParseResultElement`, or a child element with its document in `dereference.strategyOpts.parseResult` | `ReferenceSet`; for a child element the root reference wraps the child, not the entry document |
| `bundleArazzo` | Arazzo document: path or URL | `ParseResultElement` holding one compound document |
| `bundleOpenAPI` | OpenAPI document: path or URL | `ParseResultElement` holding one compound document |

The plain functions take paths and URLs only. To work with a document you parsed from a string or an object, parse it first with [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme) and call the `*Element` variant with `resolve.baseURI`, so relative references have a base to resolve against. Bundling starts from a path or URL only, since only a whole document can be bundled.

A relative file system path resolves against the current working directory. Each operation fails through its own typed error, `DereferenceError`, `ResolveError`, or `BundleError`, with the underlying error on `cause`.

## Installation

```sh
npm install @usearazzo/resolver
```

Ships ESM and CommonJS builds with TypeScript declarations. Requires Node.js 20.10 or newer.

## Usage

Dereference, and the `$components.parameters` reference in the first step is gone:

```js
import { dereferenceArazzo } from '@usearazzo/resolver';
import { toValue } from '@speclynx/apidom-core';

const parseResult = await dereferenceArazzo('./adopt-a-pet.arazzo.yaml');

toValue(parseResult.api.workflows.get(0).steps.get(0).parameters.get(0));
// { name: 'petId', in: 'path', value: '$inputs.petId' }
```

Resolve, and get the reference graph without touching the documents:

```js
import { resolveOpenAPI } from '@usearazzo/resolver';

const refSet = await resolveOpenAPI('https://example.com/openapi.yaml');

refSet.rootRef.uri; // 'https://example.com/openapi.yaml'
[...refSet.values()].map((ref) => ref.uri); // entry document first, then every document it reaches
```

Bundle, and an external Parameter Object now lives in `components`:

```js
import { bundleOpenAPI } from '@usearazzo/resolver';
import { toValue } from '@speclynx/apidom-core';

const parseResult = await bundleOpenAPI('./openapi.yaml');

toValue(parseResult.api.paths.get('/users').get.parameters.get(0));
// { $ref: '#/components/parameters/limit' }
```

Documents parsed in memory go through the `*Element` variant with a base URI:

```js
import { parseArazzo } from '@usearazzo/parser';
import { dereferenceArazzoElement } from '@usearazzo/resolver';

const parseResult = await parseArazzo(yamlText);
const dereferenced = await dereferenceArazzoElement(parseResult, {
  resolve: { baseURI: 'https://example.com/adopt-a-pet.arazzo.yaml' },
});
```

Everything else, from options and source descriptions to result shapes and error handling, is in the API reference:

**[API reference](https://usearazzo.com/docs/resolver/)**

## Supported versions

Arazzo documents:

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

OpenAPI documents, as source descriptions or on their own:

- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Part of the Arazzo Toolkit

`@usearazzo/resolver` is the reference layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/parser](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/parser#readme), [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme), and [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
