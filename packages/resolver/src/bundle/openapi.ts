import { ParseResultElement } from '@speclynx/apidom-datamodel';
import {
  url,
  bundle as bundleURI,
  mergeOptions,
  UnmatchedBundleStrategyError,
} from '@speclynx/apidom-reference/configuration/empty';
import type { ApiDOMReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import OpenAPI2BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-2';
import OpenAPI3_0BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-3-0';
import OpenAPI3_1BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-3-1';
import { isSwaggerElement } from '@speclynx/apidom-ns-openapi-2';
import { isOpenApi3_0Element } from '@speclynx/apidom-ns-openapi-3-0';
import { isOpenApi3_1Element } from '@speclynx/apidom-ns-openapi-3-1';
import type { PartialDeep } from 'type-fest';

import { defaultOptions as dereferenceDefaultOptions } from '../dereference/openapi.ts';
import BundleError from '../errors/BundleError.ts';

/**
 * Options for bundling OpenAPI Documents.
 * @public
 */
export type Options = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default reference options for bundling OpenAPI Documents.
 *
 * Bundling reads only the bundle strategies plus the resolvers and parsers that fetch
 * external documents, so no resolve or dereference strategies are configured.
 * @public
 */
export const defaultOptions: Options = {
  resolve: {
    resolvers: [...dereferenceDefaultOptions.resolve!.resolvers!],
  },
  parse: {
    parsers: [...dereferenceDefaultOptions.parse!.parsers!],
    parserOpts: { ...dereferenceDefaultOptions.parse!.parserOpts },
  },
  bundle: {
    strategies: [
      new OpenAPI2BundleStrategy(),
      new OpenAPI3_0BundleStrategy(),
      new OpenAPI3_1BundleStrategy(),
    ],
  },
};

/**
 * Bundles an OpenAPI Document from a file system path or HTTP(S) URL.
 *
 * This function hoists every external document reached through JSON References ($ref)
 * into the components of the OpenAPI Document, producing a single compound document.
 *
 * Supports OpenAPI 2.0 (Swagger), OpenAPI 3.0.x, and OpenAPI 3.1.x.
 *
 * @param uri - A file system path or HTTP(S) URL to the OpenAPI Document
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the bundled OpenAPI Document as ApiDOM element
 * @throws BundleError - When bundling fails or document is not an OpenAPI specification. The original error is available via the `cause` property.
 *
 * @example
 * // Bundle from file
 * const result = await bundleOpenAPI('/path/to/openapi.json');
 *
 * @example
 * // Bundle from URL
 * const result = await bundleOpenAPI('https://example.com/openapi.yaml');
 *
 * @example
 * // Bundle with custom options
 * const result = await bundleOpenAPI('/path/to/openapi.json', customReferenceOptions);
 * @public
 */
export async function bundle(uri: string, options: Options = {}): Promise<ParseResultElement> {
  const mergedOptions = mergeOptions(defaultOptions as ApiDOMReferenceOptions, options);

  // a relative file system path resolves against the current working directory; the string
  // doubles as the base URI for relative references, where a relative base resolves against
  // the filesystem root instead of the document. A leading slash or backslash (UNC,
  // drive-rooted) is already rooted and passes through untouched. `uri` itself is left as
  // is so error messages below quote what the caller passed in.
  const retrievalURI =
    !url.isHttpUrl(uri) && url.getProtocol(uri) !== 'file' && !/^[\\/]/.test(uri)
      ? url.resolve(url.fromFileSystemPath(url.cwd()), uri)
      : uri;

  try {
    const parseResult = await bundleURI(retrievalURI, mergedOptions);

    // validate that the bundled document is an OpenAPI specification
    if (!isOpenApiElement(parseResult.api)) {
      throw new UnmatchedBundleStrategyError(
        `Could not find a bundle strategy that can bundle "${uri}" as an OpenAPI specification`,
      );
    }

    parseResult.meta.set('retrievalURI', retrievalURI);
    return parseResult;
  } catch (error: unknown) {
    throw new BundleError(`Failed to bundle OpenAPI Document at "${uri}"`, {
      cause: error,
    });
  }
}

/**
 * Checks if the element is a valid OpenAPI specification element.
 */
function isOpenApiElement(element: unknown): boolean {
  return isSwaggerElement(element) || isOpenApi3_0Element(element) || isOpenApi3_1Element(element);
}
