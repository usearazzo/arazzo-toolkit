# @usearazzo/validator

`@usearazzo/validator` is a validator and linter for [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) documents.
It performs JSON Schema validation, semantic validation, and semantic linting using [SpecLynx ApiDOM Language Service](https://www.npmjs.com/package/@speclynx/apidom-ls).

**Supported Arazzo versions:**
- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)

**Requirements:**
- Node.js >= 20.10.0

## Installation

You can install this package via [npm](https://npmjs.org/) CLI by running the following command:

```sh
npm install @usearazzo/validator
```

## Programmatic API

`@usearazzo/validator` provides two validation functions:

- **`validateURI`** - Primary API for validating Arazzo documents from file paths or URLs
- **`validate`** - Lower-level API for using [`TextDocument`](https://www.npmjs.com/package/vscode-languageserver-textdocument)

## Validating Arazzo Documents

### From file

```js
import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';

const diagnostics = await validateURI('/path/to/arazzo.yaml');
```

### From URL

```js
import { validateURI } from '@usearazzo/validator';

const diagnostics = await validateURI('https://example.com/arazzo.yaml');
```

### From TextDocument

When you already have document content in memory, use the lower-level `validate` function with `createTextDocument`:

```js
import { validate, createTextDocument } from '@usearazzo/validator';

const content = `
arazzo: '1.0.1'
info:
  title: My Workflow
  version: '1.0.0'
sourceDescriptions:
  - name: myApi
    type: openapi
    url: https://example.com/openapi.json
workflows:
  - workflowId: myWorkflow
    steps:
      - stepId: step1
        operationId: myApi.getUsers
`;

const textDocument = createTextDocument('file:///path/to/arazzo.yaml', content);
const diagnostics = await validate(textDocument);
```

Alternatively, use `TextDocument.create()` directly for full control:

```js
import { validate, TextDocument } from '@usearazzo/validator';

const textDocument = TextDocument.create('file:///path/to/arazzo.yaml', 'apidom', 1, content);
const diagnostics = await validate(textDocument);
```

## Validation options

### Customizing language service context

The `validateURI` and `validate` functions accept an optional context parameter to customize validation behavior:

```js
import { validateURI } from '@usearazzo/validator';

const diagnostics = await validateURI('/path/to/arazzo.yaml', {
  validationContext: {
    jsonSchemaValidation: true,   // Validate against JSON Schema (default: true)
    semanticValidation: true,     // Perform semantic validation (default: true)
    referenceValidation: false,   // Validate references (default: true for validateURI, false for validate)
    semanticLinting: true,        // Apply linting rules (default: true)
    betterAjvErrors: true,        // Use improved error messages (default: true)
  },
  parseContext: {
    fileAllowList: ['*'],         // Glob patterns for allowed files (default: ['*'])
    arazzo: {
      sourceDescriptionsResolution: true, // Resolve source descriptions (default: true)
    },
  },
});
```

`referenceValidation` defaults differently depending on which function you call: `validateURI` always resolves its input to a real, absolute document location, so it turns reference validation on and anchors it (`baseURI`) to that location — this is what allows relative `sourceDescriptions[].url` entries to resolve correctly. The lower-level `validate` function works from an in-memory `TextDocument` that may not have a resolvable `uri` at all, so it leaves `referenceValidation` off by default; pass `baseURI` yourself via the context parameter if you need it on.

### Customizing URI resolution

`validateURI` also canonicalizes its input into an absolute URI before doing anything else — a relative path (`./arazzo.yaml`), an absolute path, or any legal form of a `file:` URI all normalize to the same absolute location, which is what makes relative external references inside the document (e.g. `sourceDescriptions[].url: ./openapi.yaml`) resolve correctly regardless of how the input was given.

To fetch that document, `validateURI` reuses the file and HTTP resolvers from [`@usearazzo/parser`](https://www.npmjs.com/package/@usearazzo/parser)'s default options. The `validateURI` function accepts an optional third parameter for overriding these. The shape of these options is defined by [SpecLynx ApiDOM Reference Resolve Options](https://github.com/speclynx/apidom/blob/main/packages/apidom-reference/src/options/index.ts):

```js
import { validateURI } from '@usearazzo/validator';

const diagnostics = await validateURI('https://example.com/arazzo.yaml', {}, {
  resolverOpts: {
    timeout: 10000, // HTTP timeout in milliseconds
  },
});
```

### Security considerations

By default, `validateURI`'s file resolver (from `@usearazzo/parser`) allows reading local `.json`/`.yaml`/`.yml` files, matched via regex rather than glob patterns so dotfile basenames (e.g. `.arazzo.yaml`) are matched correctly too. Separately, `parseContext.fileAllowList` is set to `['*']` by default, which allows the validator to access any file on the filesystem when resolving source descriptions during semantic linting. Additionally, `sourceDescriptionsResolution` is enabled by default, which means the validator will fetch and parse external documents referenced in the Arazzo document.

When validating untrusted documents, consider restricting file access:

```js
const diagnostics = await validateURI('/path/to/arazzo.yaml', {
  parseContext: {
    fileAllowList: [],  // Disable file access
    arazzo: {
      sourceDescriptionsResolution: false, // Disable source description resolution
    },
  },
});
```

## Default options

You can import the default options to inspect or extend them:

```js
import {
  defaultArazzoResolveOptions,
  defaultLanguageServiceContext,
} from '@usearazzo/validator';
```

- `defaultArazzoResolveOptions` - file and HTTP resolvers configuration used by `validateURI`
- `defaultLanguageServiceContext` - validation settings (JSON Schema, semantic validation, linting)

## Working with diagnostics

Both validation functions return an array of [Diagnostic](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnostic) objects compatible with VS Code and the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

```js
import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';

const diagnostics = await validateURI('/path/to/arazzo.yaml');
const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
const warnings = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Warning);
const isValid = errors.length === 0;
```

## Validation rules

For a complete reference of all semantic validation and linting rules with their numeric diagnostic codes, see [docs/rules.md](https://github.com/usearazzo/arazzo-toolkit/blob/main/packages/validator/docs/rules.md).
