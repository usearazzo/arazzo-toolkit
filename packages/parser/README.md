<h1 align="center">@usearazzo/parser</h1>

<p align="center">
  Parser for the <a href="https://spec.openapis.org/arazzo/latest.html">Arazzo Specification</a> language:
  documents, runtime expressions, and criterion conditions.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usearazzo/parser"><img src="https://img.shields.io/npm/v/@usearazzo/parser.svg" alt="npm version"></a>
  <a href="https://github.com/usearazzo/arazzo-toolkit/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License: Apache 2.0"></a>
</p>

<p align="center">
  <a href="https://usearazzo.com"><img alt="UseArazzo" width="96" src="https://usearazzo.com/assets/images/logos/usearazzo-logo.svg"></a>
</p>

---

## What it parses

An Arazzo document is three languages in one file. This package reads all of them:

- **Documents.** `parseArazzo` and `parseOpenAPI` turn an Arazzo or OpenAPI document, from a file, a URL, a string, or a plain object, into a typed [SpecLynx ApiDOM](https://github.com/speclynx/apidom) tree with optional source positions.
- **Runtime expressions.** `parseRuntimeExpression` parses `$inputs.x`, `$steps.y.outputs.z`, `$response.body#/a/b`, and friends into an AST.
- **Criterion conditions.** `parseCriterionCondition` parses the `simple` criterion grammar, such as `$statusCode == 200`, into an AST.

The expression and condition parsers are pure syntax parsers: a string in, an AST plus diagnostics out, no evaluation and no document required. Evaluating them against runtime state is [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme)'s job.

## At a glance

| Function | Takes | Returns |
|---|---|---|
| `parseArazzo` | Arazzo document: path, URL, JSON or YAML string, or object | `ParseResultElement` with a typed `api` tree, `errors`, `warnings` |
| `parseOpenAPI` | OpenAPI document, same inputs | `ParseResultElement` for OpenAPI 2.0, 3.0.x, or 3.1.x |
| `parseRuntimeExpression` | Bare expression such as `$steps.findPet.outputs.petId` | `{ result, tree }`, never throws on invalid syntax |
| `parseCriterionCondition` | `simple` condition such as `$statusCode == 200` | `{ result, tree }`, with each embedded expression parsed too |

Documents come back as ApiDOM, so source positions for editor tooling, formatting-preserving round trips, and one-call parsing of every source description an Arazzo document points at are all options away.

## Installation

```sh
npm install @usearazzo/parser
```

Ships ESM and CommonJS builds with TypeScript declarations. Requires Node.js 20.10 or newer.

## Usage

```js
import { parseArazzo } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';

const parseResult = await parseArazzo('./adopt-a-pet.arazzo.yaml');

parseResult.errors.length; // 0
toValue(parseResult.api.info.title); // 'Pet adoption'
toValue(parseResult.api.workflows.get(0).workflowId); // 'adopt-a-pet'
parseResult.api.workflows.get(0).steps.length; // 2
```

The two grammar parsers are synchronous and need no document:

```js
import { parseRuntimeExpression, parseCriterionCondition } from '@usearazzo/parser';

parseRuntimeExpression('$steps.findPet.outputs.petId').tree;
// { type: 'StepsExpression', stepId: 'findPet', field: 'outputs', outputName: 'petId' }

parseCriterionCondition('$statusCode == 200').result.success; // true
parseCriterionCondition('$statusCode ===').result.success; // false, and nothing thrown
```

Everything else, from parse options and source maps to parsing source descriptions and error handling, is in the API reference:

**[API reference](https://usearazzo.com/docs/parser/)** &middot; **[Parsing Arazzo Documents guide](https://usearazzo.com/docs/guides/arazzo-document-parsing/)**

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

`@usearazzo/parser` is the reading layer of the [arazzo-toolkit](https://github.com/usearazzo/arazzo-toolkit) monorepo, beside [@usearazzo/resolver](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/resolver#readme), [@usearazzo/validator](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/validator#readme), and [@usearazzo/runner](https://github.com/usearazzo/arazzo-toolkit/tree/main/packages/runner#readme). Questions and ideas go to [GitHub Discussions](https://github.com/orgs/usearazzo/discussions).
