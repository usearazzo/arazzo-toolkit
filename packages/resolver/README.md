<h1 align="center">@usearazzo/resolver</h1>

<p align="center">
  Reference resolver for <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo</a> and <a href="https://spec.openapis.org/oas/latest.html">OpenAPI</a> documents:
  bundle, dereference, and resolve.
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

Arazzo and OpenAPI documents contain references, to other parts of the same document and to other documents. This package handles those references in three ways, all on [SpecLynx ApiDOM](https://github.com/speclynx/apidom):

- **Bundle.** `bundleArazzo` and `bundleOpenAPI` pull external documents into the entry document's components, producing a single *compound document* that still reads like the original: external JSON Schema resources land in `components.inputs` in Arazzo; Reference Object targets land in the matching `components` field and external Path Items in `components.pathItems` in OpenAPI. References are repointed to the hoisted components.
- **Dereference.** `dereferenceArazzo` and `dereferenceOpenAPI` replace every reference with the content it points at: JSON Schema References and Reusable Object references (`$components.*`) in Arazzo; Reference Objects, Path Item references, and schema references in OpenAPI. The result is one self-contained directed graph: a Directed Acyclic Graph (DAG), or a Directed Cyclic Graph (DCG) when references form cycles. Arazzo source descriptions can be dereferenced along with the entry document.
- **Resolve.** `resolveArazzo` and `resolveOpenAPI` fetch the document and every external document its references reach, and return the `ReferenceSet` listing them all, parsed. Nothing is replaced; this is the reference graph itself.

## At a glance

| Function | Takes | Returns |
|---|---|---|
| `bundleArazzo`, `bundleOpenAPI` | path or URL | `ParseResultElement` holding one compound document |
| `dereferenceArazzo`, `dereferenceOpenAPI` | path or URL | `ParseResultElement` with every reference replaced inline |
| `dereferenceArazzoElement`, `dereferenceOpenAPIElement` | a parsed document (`ParseResultElement`), or a single element inside it, such as a workflow or a path item | the same element, dereferenced |
| `resolveArazzo`, `resolveOpenAPI` | path or URL | `ReferenceSet` of every document reached |
| `resolveArazzoElement`, `resolveOpenAPIElement` | a parsed document (`ParseResultElement`), or a single element inside it, such as a workflow or a path item | `ReferenceSet` of every document reached |

Each operation fails through its own typed error, `BundleError`, `DereferenceError`, or `ResolveError`, with the underlying error on `cause`.

## Installation

```sh
npm install @usearazzo/resolver
```

Ships ESM and CommonJS builds with TypeScript declarations. Requires Node.js 20.10 or newer.

## Usage

```js
import { bundleArazzo, dereferenceArazzo, resolveArazzo } from '@usearazzo/resolver';

const bundled = await bundleArazzo('./adopt-a-pet.arazzo.yaml'); // ParseResultElement
const dereferenced = await dereferenceArazzo('./adopt-a-pet.arazzo.yaml'); // ParseResultElement
const refSet = await resolveArazzo('./adopt-a-pet.arazzo.yaml'); // ReferenceSet
```

The OpenAPI source descriptions have their own counterparts:

```js
import { bundleOpenAPI, dereferenceOpenAPI, resolveOpenAPI } from '@usearazzo/resolver';

const bundled = await bundleOpenAPI('./petstore.openapi.yaml'); // ParseResultElement
const dereferenced = await dereferenceOpenAPI('./petstore.openapi.yaml'); // ParseResultElement
const refSet = await resolveOpenAPI('./petstore.openapi.yaml'); // ReferenceSet
```

`dereferenceArazzoElement`, `resolveArazzoElement` and their OpenAPI counterparts take a document you already parsed. When that document came from a string or an object, it has no URL of its own, so pass `resolve.baseURI` explicitly:

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
