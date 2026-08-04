import type { Diagnostic } from 'vscode-languageserver-types';
import type { LanguageServiceContext } from '@speclynx/apidom-ls';
import { defaultParseArazzoOptions } from '@usearazzo/parser';
import {
  readFile,
  mergeOptions,
  url,
  type ApiDOMReferenceResolveOptions,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import type { PartialDeep } from 'type-fest';
import { mergeDeepRight } from 'ramda';

import { createTextDocument } from '../document.ts';
import { validate } from './validate.ts';

/**
 * Default resolve options for URI resolution in validateURI.
 *
 * These options control how files and URLs are fetched when validating
 * Arazzo documents from URIs.
 *
 * @public
 */
export const defaultArazzoResolveOptions = defaultParseArazzoOptions.resolve;

/**
 * Canonicalizes a document source (path or URL) into an absolute URI.
 *
 * http(s) URLs pass through untouched. A filesystem path (relative or
 * absolute) or a `file:` URI is resolved against the current working
 * directory (a no-op when already absolute) and normalized. Uses
 * `@speclynx/apidom-reference`'s own isomorphic `url` utilities rather than
 * `node:path`/`node:url`, since this module is also bundled for the browser
 * target. This canonical URI doubles as the `baseURI` used to resolve
 * relative external references (e.g. `sourceDescriptions[].url`) within
 * the document.
 */
function canonicalizeDocumentURI(source: string): string {
  if (url.isHttpUrl(source)) {
    return source;
  }
  return url.sanitize(url.resolve(url.cwd(), source));
}

/**
 * Validates an Arazzo Document from a URI (file path or HTTP(S) URL).
 *
 * This is the primary API for validation. It fetches the document from the
 * specified URI and performs JSON Schema validation, semantic validation,
 * and linting.
 *
 * @param uri - The file system path or HTTP(S) URL to the Arazzo Document
 * @param context - Optional language service context override (deep merged with defaults)
 * @param resolveOptions - Optional resolve options for fetching the URI
 * @returns Promise resolving to an array of Diagnostic objects
 *
 * @example
 * Validate from file
 * ```typescript
 * import { validateURI, DiagnosticSeverity } from '@usearazzo/validator';
 *
 * const diagnostics = await validateURI('/path/to/arazzo.yaml');
 * const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
 * ```
 *
 * @example
 * Validate from URL
 * ```typescript
 * const diagnostics = await validateURI('https://example.com/arazzo.yaml');
 * ```
 *
 * @example
 * Validate with custom context
 * ```typescript
 * const diagnostics = await validateURI('/path/to/arazzo.yaml', {
 *   validationContext: { jsonSchemaValidation: true }
 * });
 * ```
 *
 * @example
 * Validate with custom resolve options
 * ```typescript
 * const diagnostics = await validateURI('/path/to/arazzo.yaml', {}, {
 *   resolverOpts: { timeout: 10000 }
 * });
 * ```
 * @public
 */
export async function validateURI(
  uri: string,
  context: PartialDeep<LanguageServiceContext> = {},
  resolveOptions: PartialDeep<ApiDOMReferenceResolveOptions> = {},
): Promise<Diagnostic[]> {
  const canonicalURI = canonicalizeDocumentURI(uri);
  const mergedOptions = mergeOptions(defaultParseArazzoOptions as ApiDOMReferenceOptions, {
    resolve: resolveOptions,
  });
  const buffer = await readFile(canonicalURI, mergedOptions);
  const content = new TextDecoder().decode(buffer);
  const textDocument = createTextDocument(canonicalURI, content);

  // validateURI always has a real, resolvable document location, so it anchors
  // resolution of relative source descriptions to that location.
  const uriDefaults: PartialDeep<LanguageServiceContext> = {
    validationContext: { baseURI: canonicalURI },
  };

  return validate(textDocument, mergeDeepRight(uriDefaults, context));
}
