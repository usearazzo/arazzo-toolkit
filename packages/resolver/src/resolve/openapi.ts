import { Element, isParseResultElement } from '@speclynx/apidom-datamodel';
import {
  url,
  resolve as resolveURI,
  resolveApiDOM as resolveApiDOMElement,
  mergeOptions,
  UnmatchedResolveStrategyError,
} from '@speclynx/apidom-reference/configuration/empty';
import type {
  ApiDOMReferenceOptions,
  ReferenceSet,
} from '@speclynx/apidom-reference/configuration/empty';
import OpenAPI2DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-2';
import OpenAPI3_0DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-3-0';
import OpenAPI3_1DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-3-1';
import OpenAPI2ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-2';
import OpenAPI3_0ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-0';
import OpenAPI3_1ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-1';
import JSONParser from '@speclynx/apidom-reference/parse/parsers/json';
import YAMLParser from '@speclynx/apidom-reference/parse/parsers/yaml-1-2';
import BinaryParser from '@speclynx/apidom-reference/parse/parsers/binary';
import type { PartialDeep } from 'type-fest';
import { defaultParseOpenAPIOptions as parserDefaultOptions } from '@usearazzo/parser';

import ResolveError from '../errors/ResolveError.ts';
import { elementContext, isOpenApiElement } from '../element-context/openapi.ts';

/**
 * Options for resolving OpenAPI Documents.
 * @public
 */
export type Options = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default reference options for resolving OpenAPI Documents.
 * @public
 */
export const defaultOptions: Options = {
  resolve: {
    resolvers: [...parserDefaultOptions.resolve!.resolvers!],
    strategies: [
      new OpenAPI2ResolveStrategy(),
      new OpenAPI3_0ResolveStrategy(),
      new OpenAPI3_1ResolveStrategy(),
    ],
  },
  parse: {
    parsers: [
      ...parserDefaultOptions.parse!.parsers!,
      new JSONParser({ allowEmpty: false }),
      new YAMLParser({ allowEmpty: false }),
      new BinaryParser({ allowEmpty: false }),
    ],
    parserOpts: { ...parserDefaultOptions.parse!.parserOpts },
  },
  dereference: {
    strategies: [
      new OpenAPI2DereferenceStrategy(),
      new OpenAPI3_0DereferenceStrategy(),
      new OpenAPI3_1DereferenceStrategy(),
    ],
    strategyOpts: {},
  },
};

/**
 * Resolves an OpenAPI Document from a file system path or HTTP(S) URL.
 *
 * This function collects the OpenAPI Document and every external document its
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced;
 * the root reference of the set holds the parsed entry document.
 *
 * Supports OpenAPI 2.0 (Swagger), OpenAPI 3.0.x, and OpenAPI 3.1.x.
 *
 * @param uri - A file system path or HTTP(S) URL to the OpenAPI Document
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the ReferenceSet of the OpenAPI Document and its external references
 * @throws ResolveError - When resolving fails or document is not an OpenAPI specification. The original error is available via the `cause` property.
 *
 * @example
 * // Resolve from file
 * const refSet = await resolveOpenAPI('/path/to/openapi.json');
 *
 * @example
 * // Resolve from URL
 * const refSet = await resolveOpenAPI('https://example.com/openapi.yaml');
 *
 * @example
 * // Resolve with custom options
 * const refSet = await resolveOpenAPI('/path/to/openapi.json', customReferenceOptions);
 * @public
 */
export async function resolve(uri: string, options: Options = {}): Promise<ReferenceSet> {
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
    const refSet = await resolveURI(retrievalURI, mergedOptions);
    const parseResult = refSet.rootRef?.value;

    // validate that the resolved document is an OpenAPI specification
    if (!isParseResultElement(parseResult) || !isOpenApiElement(parseResult.api)) {
      throw new UnmatchedResolveStrategyError(
        `Could not find a resolve strategy that can resolve "${uri}" as an OpenAPI specification`,
      );
    }

    parseResult.meta.set('retrievalURI', retrievalURI);
    return refSet;
  } catch (error: unknown) {
    throw new ResolveError(`Failed to resolve OpenAPI Document at "${uri}"`, {
      cause: error,
    });
  }
}

/**
 * Resolves an ApiDOM element representing an OpenAPI Document.
 *
 * This function collects the element and every external document its
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced.
 *
 * Supported scenarios:
 * - ParseResultElement with retrievalURI metadata: baseURI derived automatically
 * - ParseResultElement without retrievalURI: requires `options.resolve.baseURI`
 * - Child element (e.g., PathItemElement) with parseResult in strategyOpts:
 *   requires `options.dereference.strategyOpts.parseResult`,
 *   and `options.resolve.baseURI` if parseResult lacks retrievalURI metadata
 *
 * @param element - An ApiDOM element (ParseResultElement or child element like PathItemElement)
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the ReferenceSet of the element and its external references
 * @throws ResolveError - When baseURI is required but not provided, or when resolving fails
 *
 * @example
 * Resolve ParseResultElement with retrievalURI (from file parsing)
 * ```typescript
 * import { parseOpenAPI } from '@usearazzo/parser';
 *
 * const parseResult = await parseOpenAPI('/path/to/openapi.json');
 * const refSet = await resolveOpenAPIElement(parseResult);
 * ```
 *
 * @example
 * Resolve ParseResultElement without retrievalURI (from inline parsing)
 * ```typescript
 * const parseResult = await parseOpenAPI({ openapi: '3.1.0', ... });
 * const refSet = await resolveOpenAPIElement(parseResult, {
 *   resolve: { baseURI: 'https://example.com/openapi.json' },
 * });
 * ```
 *
 * @example
 * Resolve child element (e.g., PathItemElement)
 * ```typescript
 * const parseResult = await parseOpenAPI('/path/to/openapi.json');
 * const pathItem = parseResult.api.paths.get('/users');
 * const refSet = await resolveOpenAPIElement(pathItem, {
 *   dereference: { strategyOpts: { parseResult } },
 * });
 * ```
 * @public
 */
export async function resolveElement<T extends Element>(
  element: T,
  options: Options = {},
): Promise<ReferenceSet> {
  const mergedOptions = mergeOptions(defaultOptions as ApiDOMReferenceOptions, options);
  const { baseURI, mediaType, missingBaseURI } = elementContext(element, mergedOptions);

  if (missingBaseURI !== undefined) {
    throw new ResolveError(
      `baseURI option is required when resolving a ${missingBaseURI} without retrievalURI metadata`,
    );
  }

  // the seeded refSet is not forwarded: resolve strategies deep-merge their own ReferenceSet
  // over `dereference.refSet`, which would strip the prototype off the seeded instance
  try {
    return await resolveApiDOMElement(
      element,
      mergeOptions(mergedOptions, {
        resolve: {
          baseURI,
        },
        parse: {
          mediaType,
        },
      }),
    );
  } catch (error: unknown) {
    throw new ResolveError('Failed to resolve OpenAPI Document', { cause: error });
  }
}
