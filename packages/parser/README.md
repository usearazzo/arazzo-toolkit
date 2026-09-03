# @usearazzo/parser

`@usearazzo/parser` is a parser for the [Arazzo Specification](https://spec.openapis.org/arazzo/latest.html) language.
It covers all three syntaxes the specification defines:

- **Documents**: `parseArazzo` / `parseOpenAPI` produce [SpecLynx ApiDOM](https://github.com/speclynx/apidom) data model using the [Arazzo 1.x namespace](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-arazzo-1#readme).
- **Runtime expressions** (`$inputs.x`, `$steps.y.outputs.z`, `$response.body#/a/b`, …): `parseRuntimeExpression`.
- **Criterion conditions** (the `simple` criterion grammar): `parseCriterionCondition`.

`parseRuntimeExpression` and `parseCriterionCondition` are pure, context-free syntax parsers: a string in, an AST plus position-carrying diagnostics out. They perform no evaluation and require no document; evaluating a parsed expression or condition against runtime state is [@usearazzo/runner](../runner#readme)'s job. [JSONPath](https://datatracker.ietf.org/doc/html/rfc9535) and [JSON Pointer](https://datatracker.ietf.org/doc/html/rfc6901) are general-purpose syntaxes with their own ecosystems and are out of scope for this package. Use `@swaggerexpert/jsonpath` or a JSON Pointer library directly for those.

**Supported Arazzo versions:**

- [Arazzo 1.0.0](https://spec.openapis.org/arazzo/v1.0.0)
- [Arazzo 1.0.1](https://spec.openapis.org/arazzo/v1.0.1)
- [Arazzo 1.1.0](https://spec.openapis.org/arazzo/v1.1.0)

**Supported OpenAPI versions (for source descriptions):**

- [OpenAPI 2.0](https://spec.openapis.org/oas/v2.0)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2)

## Installation

You can install this package via [npm](https://npmjs.org/) CLI by running the following command:

```sh
npm install @usearazzo/parser
```

## Usage

`@usearazzo/parser` provides `parseArazzo` and `parseOpenAPI` for parsing documents, and `parseRuntimeExpression` / `parseCriterionCondition` for parsing the two embedded Arazzo grammars.

## Parsing Arazzo Documents

The `parseArazzo` function accepts multiple input types:

1. **Plain JavaScript object** - converts to JSON and parses (source maps supported with `strict: false`)
2. **String content** - detects Arazzo content and parses inline JSON or YAML
3. **File system path** - resolves and parses local Arazzo Documents
4. **HTTP(S) URL** - fetches and parses remote Arazzo Documents

### From object

```js
import { parseArazzo } from '@usearazzo/parser';

const arazzoDocument = {
  arazzo: '1.0.1',
  info: {
    title: 'My API Workflow',
    version: '1.0.0',
  },
  sourceDescriptions: [
    {
      name: 'myApi',
      type: 'openapi',
      url: 'https://example.com/openapi.json',
    },
  ],
  workflows: [],
};

const parseResult = await parseArazzo(arazzoDocument);
// parseResult is ParseResultElement containing ArazzoSpecification1Element
```

### From string

```js
import { parseArazzo } from '@usearazzo/parser';

// JSON string
const parseResult = await parseArazzo('{"arazzo": "1.0.1", "info": {...}}');

// YAML string
const parseResult = await parseArazzo(`
arazzo: '1.0.1'
info:
  title: My API Workflow
  version: '1.0.0'
`);
```

### From file

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('/path/to/arazzo.json');
```

### From URL

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('https://example.com/arazzo.yaml');
```

## Parse options

The `parseArazzo` function accepts an optional second argument with reference options compatible with [SpecLynx ApiDOM Reference Options](https://github.com/speclynx/apidom/blob/main/packages/apidom-reference/src/options/index.ts):

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo(source, {
  parse: {
    parserOpts: {
      strict: true, // Use strict parsing mode (default: true)
      sourceMap: false, // Include source maps (default: false)
      style: false, // Capture style information for round-trip preservation (default: false)
    },
  },
});
```

### Base URI for inline content

When parsing from a plain object or inline string, the document has no location of its own, so relative references (such as source description `url`s) have nothing to resolve against. Provide `resolve.baseURI` to tell the parser where the document should be treated as coming from. The in-memory content is still used for the document itself; only relative references are resolved against the base URI, and it is recorded as the `retrievalURI` metadata:

```js
import { parseArazzo } from '@usearazzo/parser';

const arazzoDocument = {
  arazzo: '1.0.1',
  info: { title: 'My API Workflow', version: '1.0.0' },
  sourceDescriptions: [{ name: 'myApi', type: 'openapi', url: './openapi.json' }],
  workflows: [],
};

const parseResult = await parseArazzo(arazzoDocument, {
  resolve: { baseURI: '/path/to/arazzo.json' },
  parse: { parserOpts: { sourceDescriptions: true } },
});

parseResult.meta.get('retrievalURI'); // '/path/to/arazzo.json'
parseResult.get(1).meta.get('retrievalURI'); // '/path/to/openapi.json'
```

Relative references are resolved against the base URI the same way as for a file system path or URL passed directly to `parseArazzo`, so it must be absolute; a relative value is not resolved against the working directory. The base URI itself is never read: the in-memory content is always what gets parsed, so it need not exist or have a recognized extension. It is served by the parser's own `memory` resolver, which is placed ahead of any resolvers configured through `resolve.resolvers`. `parseOpenAPI` accepts the option in the same way.

### Default options

You can import the default options:

```js
import { defaultParseArazzoOptions } from '@usearazzo/parser';
import { defaultParseOpenAPIOptions } from '@usearazzo/parser';

console.dir(defaultParseArazzoOptions, { depth: null });
console.dir(defaultParseOpenAPIOptions, { depth: null });
```

## Error handling

When parsing fails, a `ParseError` is thrown (from both `parseArazzo` and `parseOpenAPI`). The original error is available via the `cause` property:

```js
import { parseArazzo, ParseError } from '@usearazzo/parser';

try {
  await parseArazzo('invalid content');
} catch (error) {
  if (error instanceof ParseError) {
    console.error(error.message); // 'Failed to parse Arazzo Document'
    console.error(error.cause); // Original error from underlying parser
  }
  throw error;
}
```

## Working with the result

The `parseArazzo` function returns a [ParseResultElement](https://github.com/speclynx/apidom/blob/main/packages/apidom-datamodel/README.md#parseresultelement) representing the result of the parsing operation.

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo(source);

// Access the main Arazzo specification element
const arazzoSpec = parseResult.api;

// Check if parsing produced any errors
const hasErrors = parseResult.errors.length > 0;

// Check if parseResult is empty
const isEmpty = parseResult.isEmpty;
```

### Retrieval URI metadata

When parsing from a file system path or HTTP(S) URL, the `retrievalURI` metadata is set on the parse result:

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('/path/to/arazzo.json');

// Get the URI from which the document was retrieved
const uri = parseResult.meta.get('retrievalURI');
// '/path/to/arazzo.json'
```

Note: `retrievalURI` is not set when parsing from inline content (string) or plain objects, unless `resolve.baseURI` is provided (see [Base URI for inline content](#base-uri-for-inline-content)).

### Source maps

Source maps allow you to track the original position (line, column) of each element in the parsed document. This is useful for error reporting, IDE integrations, linting, and any tooling that needs to show precise locations in the original source.

To enable source maps, set `sourceMap: true` and `strict: false` in the parser options:

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('/path/to/arazzo.yaml', {
  parse: {
    parserOpts: {
      sourceMap: true,
      strict: false,
    },
  },
});
```

When source maps are enabled, each element in the parsed result contains positional properties stored directly on the element. Position values use UTF-16 code units for compatibility with Language Server Protocol (LSP) and JavaScript string indexing:

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('/path/to/arazzo.yaml', {
  parse: { parserOpts: { sourceMap: true, strict: false } },
});

const arazzoSpec = parseResult.api;

// Access source map properties directly on the element
arazzoSpec.startLine; // 0-based line number where element begins
arazzoSpec.startCharacter; // 0-based column number where element begins
arazzoSpec.startOffset; // 0-based character offset from document start
arazzoSpec.endLine; // 0-based line number where element ends
arazzoSpec.endCharacter; // 0-based column number where element ends
arazzoSpec.endOffset; // 0-based character offset where element ends

// Access source map on nested elements
const workflow = arazzoSpec.workflows.get(0);
console.log(`Workflow starts at line ${workflow.startLine}, column ${workflow.startCharacter}`);
```

For more details about source maps, see the [SpecLynx ApiDOM Data Model documentation](https://github.com/speclynx/apidom/tree/main/packages/apidom-datamodel#source-maps).

**Note:** Source maps require `strict: false` to be set. When parsing from objects, they are converted to pretty-printed JSON strings internally (2-space indentation), so source map positions refer to this generated JSON representation, not the original object structure:

```js
// Source maps with objects (requires strict: false)
// Positions will reference the internally generated JSON string
await parseArazzo({ arazzo: '1.0.1', ... }, {
  parse: {
    parserOpts: {
      sourceMap: true,
      strict: false
    }
  },
});
```

### Style preservation

Style preservation captures format-specific style information for round-trip preservation. When enabled, the parser records formatting details (e.g., YAML quoting styles, flow/block indicators, comments, indentation; JSON indentation, raw number representation) on each parsed element. These details can then be used by [`toYAML`](https://github.com/speclynx/apidom/tree/main/packages/apidom-core#toyaml) and [`toJSON`](https://github.com/speclynx/apidom/tree/main/packages/apidom-core#tojson) from `@speclynx/apidom-core` to reproduce the original formatting.

To enable style preservation, set `style: true` and `strict: false` in the parser options:

```js
import { parseArazzo } from '@usearazzo/parser';
import { toYAML } from '@speclynx/apidom-core';

const parseResult = await parseArazzo('/path/to/arazzo.yaml', {
  parse: {
    parserOpts: {
      style: true,
      strict: false,
    },
  },
});

// round-trip back to YAML preserving original formatting
const yaml = toYAML(parseResult.api, { preserveStyle: true });
```

```js
import { parseArazzo } from '@usearazzo/parser';
import { toJSON } from '@speclynx/apidom-core';

const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      style: true,
      strict: false,
    },
  },
});

// round-trip back to JSON preserving original formatting
const json = toJSON(parseResult.api, undefined, undefined, { preserveStyle: true });
```

**Note:** Style preservation requires `strict: false`. Both `style` and `sourceMap` can be enabled simultaneously — they are independent features.

## Parsing source descriptions

Arazzo documents can reference external API specifications (OpenAPI, Arazzo) through [Source Descriptions](https://spec.openapis.org/arazzo/latest.html#source-description-object). The parser can automatically fetch and parse these referenced documents.

**Note:** Source descriptions parsing is disabled by default for performance reasons. Enable it explicitly when you need to resolve and parse referenced API specifications.

**Note:** Relative source description `url`s are resolved against the URI the parent Arazzo document was retrieved from. When the parent is passed as a plain object or inline string without `resolve.baseURI`, that URI is a synthetic `memory://` one, so a relative `url` resolves to a `memory://` URI that no resolver can retrieve. The source description gets an `error` annotation stating this: `Error parsing source description "memory://arazzo.json/openapi.json": relative URL cannot be resolved because the parent document was parsed from inline content. Provide resolve.baseURI or an absolute $self.` Provide `resolve.baseURI` in that case (see [Base URI for inline content](#base-uri-for-inline-content)), use absolute `http(s)://` or `file://` URLs, or declare a `$self` with a scheme (`file://`, `https://`) on the parent document.

### Enabling source descriptions parsing

To parse source descriptions, enable the `sourceDescriptions` option in `parserOpts`:

```js
import { parseArazzo } from '@usearazzo/parser';

const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});
```

Alternatively, you can configure it per parser for more granular control:

```js
const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      'arazzo-json-1': { sourceDescriptions: true },
      'arazzo-yaml-1': { sourceDescriptions: true },
    },
  },
});
```

### Selective parsing

You can selectively parse only specific source descriptions by providing an array of names:

```js
const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: ['petStoreApi', 'paymentApi'],
    },
  },
});
```

### Result structure

When source descriptions are parsed, each parsed document that is a _direct_ source description of the main Arazzo document is added to the main `ParseResultElement` as an additional top-level element. The first element is always the main Arazzo document, and subsequent top-level elements are these directly parsed source descriptions. When recursive parsing discovers further source descriptions from within an already parsed source description, those recursively parsed documents are attached as nested `ParseResultElement` instances beneath the source-description element that referenced them (they are not duplicated at the top level). Consumers that need to see all documents should traverse both the top-level elements and any nested `ParseResultElement`s reachable from source-description elements.

Source descriptions are parsed into their appropriate SpecLynx ApiDOM namespace data models based on document type:

- [Arazzo 1.x](https://spec.openapis.org/arazzo/latest.html) → [@speclynx/apidom-ns-arazzo-1](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-arazzo-1)
- [OpenAPI 2.0 (Swagger)](https://spec.openapis.org/oas/v2.0) → [@speclynx/apidom-ns-openapi-2](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-2)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4) → [@speclynx/apidom-ns-openapi-3-0](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-3-0)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2) → [@speclynx/apidom-ns-openapi-3-1](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-3-1)

```
ParseResultElement
├── .api: ArazzoSpecification1Element
│
├── ParseResultElement (petStoreApi)        ─┐
│   └── .api: OpenApi3_1Element              │ source
│                                            │ descriptions
└── ParseResultElement (legacyApi)          ─┘
    ├── .errors
    └── .warnings
```

```js
import { parseArazzo } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';

const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});

// Main Arazzo document
const arazzoSpec = parseResult.api;

// Number of elements (1 main + N source descriptions)
console.log(parseResult.length);

// Access parsed source descriptions (filter by 'source-description' class)
for (let i = 0; i < parseResult.length; i++) {
  const element = parseResult.get(i);

  if (element.classes.includes('source-description')) {
    // Source description metadata
    const name = toValue(element.meta.get('name'));
    const type = toValue(element.meta.get('type'));

    console.log(`Source description "${name}" (${type})`);

    // The parsed API document
    const api = element.api;
  }
}
```

### Accessing via SourceDescriptionElement

An alternative way to access parsed source descriptions is through the `SourceDescriptionElement` metadata.
When source descriptions are parsed, a `ParseResultElement` is attached to each `SourceDescriptionElement`'s metadata under the key `'parseResult'`.

```js
import { parseArazzo } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';

const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});

const arazzoSpec = parseResult.api;

// Access parsed document via SourceDescriptionElement
const sourceDesc = arazzoSpec.sourceDescriptions.get(0);
const sdParseResult = sourceDesc.meta.get('parseResult');

// Check for errors before using
if (sdParseResult.errors.length === 0) {
  // Access the parsed API
  const api = sdParseResult.api;
  console.log(`API type: ${api.element}`); // e.g., 'openApi3_1'

  // Get the retrieval URI
  const retrievalURI = sdParseResult.meta.get('retrievalURI');
  console.log(`Loaded from: ${retrievalURI}`);
}
```

This approach is useful when you need to:

- Access a specific source description by its position in the `sourceDescriptions` array
- Get the `retrievalURI` metadata indicating where the document was fetched from
- Correlate parsed documents with their source description definitions

### Recursive parsing

When a source description is of type `arazzo`, the parser recursively parses that document's source descriptions as well. This allows you to parse entire dependency trees of Arazzo documents.

### Limiting recursion depth

To prevent excessive recursion or handle deeply nested documents, use the `sourceDescriptionsMaxDepth` option:

```js
const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
      sourceDescriptionsMaxDepth: 2, // Only parse 2 levels deep
    },
  },
});
```

The default value is `+Infinity` (no limit). Setting it to `0` will create error annotations instead of parsing any source descriptions.

### Cycle detection

The parser automatically detects circular references between Arazzo documents. When a cycle is detected, a warning annotation is added instead of causing infinite recursion:

```js
// arazzo-a.json references arazzo-b.json
// arazzo-b.json references arazzo-a.json (cycle!)

const parseResult = await parseArazzo('/path/to/arazzo-a.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});

// The cycle is handled gracefully - check for warning annotations
```

Reaching the same document a second time through a different path is not a cycle. A document shared by several
Arazzo documents (typically one OpenAPI description used by every workflow document) is parsed only once, and every
later source description referencing it gets a `ParseResultElement` that has no `api` of its own, carries an `info`
annotation, and points at the `ParseResultElement` where the document was parsed via its `'parseResult'` metadata.
The `SourceDescriptionElement`'s `'parseResult'` metadata points at that same `ParseResultElement`:

```js
// arazzo-a.json references openapi.json and arazzo-b.json
// arazzo-b.json references openapi.json as well (shared, not a cycle)

const parseResult = await parseArazzo('/path/to/arazzo-a.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});

const arazzoB = parseResult.get(2);
const sharedOpenApi = arazzoB.api.sourceDescriptions.get(0).meta.get('parseResult');
sharedOpenApi === parseResult.get(1); // true; the OpenAPI document parsed for arazzo-a.json
```

### Error and warning handling

When issues occur during source description parsing, the parser does not throw errors. Instead, it adds annotation elements to the source description's parse result:

- **`error`** class - Parsing failed (e.g., file not found, invalid document, max depth exceeded)
- **`warning`** class - Non-fatal issues (e.g., cycle detected, type mismatch between declared and actual)
- **`info`** class - Nothing went wrong (e.g., a shared document was reused instead of being parsed again)

This allows partial parsing to succeed even if some source descriptions have issues:

```js
const parseResult = await parseArazzo('/path/to/arazzo.json', {
  parse: {
    parserOpts: {
      sourceDescriptions: true,
    },
  },
});

// Check each source description for errors and warnings
for (let i = 0; i < parseResult.length; i++) {
  const element = parseResult.get(i);

  if (element.classes.includes('source-description')) {
    const name = toValue(element.meta.get('name'));

    // Use built-in accessors for errors and warnings
    element.errors.forEach((error) => {
      console.error(`Error in "${name}": ${toValue(error)}`);
    });

    element.warnings.forEach((warning) => {
      console.warn(`Warning in "${name}": ${toValue(warning)}`);
    });
  }
}
```

## Parsing OpenAPI Documents

The `parseOpenAPI` function provides complete control for parsing OpenAPI documents manually.
This is useful when you need to parse source descriptions independently or implement custom source description resolution logic.

The function accepts the same input types as `parseArazzo`:

1. **Plain JavaScript object** - converts to JSON and parses
2. **String content** - detects OpenAPI content and parses inline JSON or YAML
3. **File system path** - resolves and parses local OpenAPI Documents
4. **HTTP(S) URL** - fetches and parses remote OpenAPI Documents

Documents are parsed into their appropriate SpecLynx ApiDOM namespace data models:

- [OpenAPI 2.0 (Swagger)](https://spec.openapis.org/oas/v2.0) → [@speclynx/apidom-ns-openapi-2](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-2)
- [OpenAPI 3.0.x](https://spec.openapis.org/oas/v3.0.4) → [@speclynx/apidom-ns-openapi-3-0](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-3-0)
- [OpenAPI 3.1.x](https://spec.openapis.org/oas/v3.1.2) → [@speclynx/apidom-ns-openapi-3-1](https://github.com/speclynx/apidom/tree/main/packages/apidom-ns-openapi-3-1)

```js
import { parseOpenAPI } from '@usearazzo/parser';

// From object
const parseResult = await parseOpenAPI({
  openapi: '3.1.0',
  info: { title: 'My API', version: '1.0.0' },
  paths: {},
});

// From string
const parseResult = await parseOpenAPI('{"openapi": "3.1.0", ...}');

// From file
const parseResult = await parseOpenAPI('/path/to/openapi.json');

// From URL
const parseResult = await parseOpenAPI('https://example.com/openapi.yaml');
```

## Parsing Runtime Expressions

The `parseRuntimeExpression` function parses an [Arazzo Runtime Expression](https://spec.openapis.org/arazzo/latest.html#runtime-expressions) into its AST. The expression must be the bare form without surrounding braces (e.g. `$inputs.username`, not `{$inputs.username}`). Invalid syntax never throws: it is reported through the returned `result`, so the function is safe to use as a pure syntax check (e.g. for linting expressions embedded in a document) without any evaluation context.

```js
import { parseRuntimeExpression } from '@usearazzo/parser';

// Valid expression
const { result, tree } = parseRuntimeExpression('$steps.myStep.outputs.result');
// result.success === true
// tree === { type: 'StepsExpression', stepId: 'myStep', field: 'outputs', outputName: 'result' }

// Invalid expression
const invalid = parseRuntimeExpression('$unknown.thing');
// invalid.result.success === false
// invalid.tree === undefined
// invalid.result.maxMatched - offset into the string parsing succeeded up to
```

`parseRuntimeExpression` is a thin wrapper around [@swaggerexpert/arazzo-runtime-expression](https://www.npmjs.com/package/@swaggerexpert/arazzo-runtime-expression), which is re-exported as a foundation dependency: `ASTNode` (exported here as `RuntimeExpressionASTNode`) and `ParseResult` (`ParseRuntimeExpressionResult`) are its types, following the same pattern as the ApiDOM `ParseResultElement` re-export above. Splitting a `{expression}` template into literal and expression spans, or interpolating one, is left to that package's own `extract` / `interpolate` functions, outside this package's document/expression/condition parsing surface.

`parseRuntimeExpression` does throw in two cases, both re-exported (or standard) so they can be caught by type:

- `TypeError` when `expression` is not a string.
- `ArazzoRuntimeExpressionParseError` on an unexpected internal parser error, distinct from invalid syntax (which never throws).

```js
import { parseRuntimeExpression, ArazzoRuntimeExpressionParseError } from '@usearazzo/parser';

try {
  parseRuntimeExpression(expression);
} catch (error) {
  if (error instanceof ArazzoRuntimeExpressionParseError) {
    console.error('Unexpected parser error:', error.cause);
  }
  throw error;
}
```

## Parsing Criterion Conditions

The `parseCriterionCondition` function parses the [Criterion Object](https://spec.openapis.org/arazzo/latest.html#criterion-object)'s `simple` condition grammar into its AST. Like `parseRuntimeExpression`, invalid syntax never throws and is reported through the returned `result`. Each embedded runtime expression operand is parsed too, carried on its `RuntimeExpression` AST node as a `parseRuntimeExpression`-produced sub-AST.

```js
import { parseCriterionCondition } from '@usearazzo/parser';

// Valid condition
const { result, tree } = parseCriterionCondition('$statusCode == 200');
// result.success === true
// tree.type === 'BinaryExpression'

// Invalid condition
const invalid = parseCriterionCondition('$statusCode ===');
// invalid.result.success === false
// invalid.tree === undefined
```

`parseCriterionCondition` wraps [@swaggerexpert/arazzo-criterion](https://www.npmjs.com/package/@swaggerexpert/arazzo-criterion) the same way: `ConditionAST` (`CriterionConditionAST`) and `ParseResult` (`ParseCriterionConditionResult`) are re-exported foundation types, and it throws the same two ways: `TypeError` for a non-string `condition`, and a re-exported `ArazzoCriterionParseError` for an unexpected internal parser error.

## SpecLynx ApiDOM tooling

Since `@usearazzo/parser` produces a SpecLynx ApiDOM data model, you have access to the full suite of ApiDOM tools for manipulating, traversing, and transforming the parsed document.

### Core utilities

The [@speclynx/apidom-core](https://github.com/speclynx/apidom/tree/main/packages/apidom-core) package provides essential utilities for working with ApiDOM elements. Here are just a few examples:

```js
import { parseArazzo } from '@usearazzo/parser';
import { cloneDeep, cloneShallow } from '@speclynx/apidom-datamodel';
import { toValue, toJSON, toYAML, sexprs } from '@speclynx/apidom-core';

const parseResult = await parseArazzo(source);
const arazzoSpec = parseResult.api;

// Convert to plain JavaScript object
const obj = toValue(arazzoSpec);

// Serialize to JSON string
const json = toJSON(arazzoSpec);

// Serialize to YAML string
const yaml = toYAML(arazzoSpec);

// Clone the element
const clonedShallow = cloneShallow(arazzoSpec);
const clonedDeep = cloneDeep(arazzoSpec);

// Get S-expression representation (useful for debugging)
const sexpr = sexprs(arazzoSpec);
```

### Traversal

The [@speclynx/apidom-traverse](https://github.com/speclynx/apidom/tree/main/packages/apidom-traverse) package provides powerful traversal capabilities. Here is a basic example:

```js
import { parseArazzo } from '@usearazzo/parser';
import { traverse } from '@speclynx/apidom-traverse';

const parseResult = await parseArazzo(source);

// Traverse and collect steps using semantic visitor hook
const steps = [];
traverse(parseResult.api, {
  StepElement(path) {
    steps.push(path.node);
    if (steps.length >= 10) {
      path.stop(); // Stop traversal after collecting 10 steps
    }
  },
});
```

For more information about available utilities, see the [SpecLynx ApiDOM documentation](https://github.com/speclynx/apidom).
