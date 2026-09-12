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
import Arazzo1DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/arazzo-1';
import OpenAPI2DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-2';
import OpenAPI30DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-3-0';
import OpenAPI31DereferenceStrategy from '@speclynx/apidom-reference/dereference/strategies/openapi-3-1';
import Arazzo1ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/arazzo-1';
import OpenAPI2ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-2';
import OpenAPI30ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-0';
import OpenAPI31ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-1';
import JSONParser from '@speclynx/apidom-reference/parse/parsers/json';
import YAMLParser from '@speclynx/apidom-reference/parse/parsers/yaml-1-2';
import BinaryParser from '@speclynx/apidom-reference/parse/parsers/binary';
import { isArazzoSpecification1Element } from '@speclynx/apidom-ns-arazzo-1';
import type { PartialDeep } from 'type-fest';
import { defaultParseArazzoOptions as parserDefaultOptions } from '@usearazzo/parser';

import ResolveError from '../errors/ResolveError.ts';
import { elementContext } from '../element-context/arazzo.ts';

/**
 * Options for resolving Arazzo Documents.
 * @public
 */
export type Options = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default reference options for resolving Arazzo Documents.
 * @public
 */
export const defaultOptions: Options = {
  resolve: {
    resolvers: [...parserDefaultOptions.resolve!.resolvers!],
    strategies: [
      new Arazzo1ResolveStrategy(),
      new OpenAPI2ResolveStrategy(),
      new OpenAPI30ResolveStrategy(),
      new OpenAPI31ResolveStrategy(),
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
      new Arazzo1DereferenceStrategy(),
      new OpenAPI2DereferenceStrategy(),
      new OpenAPI30DereferenceStrategy(),
      new OpenAPI31DereferenceStrategy(),
    ],
    strategyOpts: {
      sourceDescriptions: false,
    },
  },
};

/**
 * Resolves an Arazzo Document from a file system path or HTTP(S) URL.
 *
 * This function collects the Arazzo Document and every external document its
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced;
 * the root reference of the set holds the parsed entry document.
 *
 * @param uri - A file system path or HTTP(S) URL to the Arazzo Document
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the ReferenceSet of the Arazzo Document and its external references
 * @throws ResolveError - When resolving fails or document is not an Arazzo specification. The original error is available via the `cause` property.
 *
 * @example
 * // Resolve from file
 * const refSet = await resolveArazzo('/path/to/arazzo.json');
 *
 * @example
 * // Resolve from URL
 * const refSet = await resolveArazzo('https://example.com/arazzo.yaml');
 *
 * @example
 * // Resolve with custom options
 * const refSet = await resolveArazzo('/path/to/arazzo.json', customReferenceOptions);
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

    // validate that the resolved document is an Arazzo specification
    if (!isParseResultElement(parseResult) || !isArazzoSpecification1Element(parseResult.api)) {
      throw new UnmatchedResolveStrategyError(
        `Could not find a resolve strategy that can resolve "${uri}" as an Arazzo specification`,
      );
    }

    parseResult.meta.set('retrievalURI', retrievalURI);
    return refSet;
  } catch (error: unknown) {
    throw new ResolveError(`Failed to resolve Arazzo Document at "${uri}"`, {
      cause: error,
    });
  }
}

/**
 * Resolves an ApiDOM element representing an Arazzo Document.
 *
 * This function collects the element and every external document its
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced.
 *
 * Supported scenarios:
 * - ParseResultElement with retrievalURI metadata: baseURI derived automatically
 * - ParseResultElement without retrievalURI: requires `options.resolve.baseURI`
 * - Child element (e.g., WorkflowElement) with parseResult in strategyOpts:
 *   requires `options.dereference.strategyOpts.parseResult`,
 *   and `options.resolve.baseURI` if parseResult lacks retrievalURI metadata
 *
 * @param element - An ApiDOM element (ParseResultElement or child element like WorkflowElement)
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the ReferenceSet of the element and its external references
 * @throws ResolveError - When baseURI is required but not provided, or when resolving fails
 *
 * @example
 * Resolve ParseResultElement with retrievalURI (from file parsing)
 * ```typescript
 * import { parseArazzo } from '@usearazzo/parser';
 *
 * const parseResult = await parseArazzo('/path/to/arazzo.json');
 * const refSet = await resolveArazzoElement(parseResult);
 * ```
 *
 * @example
 * Resolve ParseResultElement without retrievalURI (from inline parsing)
 * ```typescript
 * const parseResult = await parseArazzo({ arazzo: '1.0.1', ... });
 * const refSet = await resolveArazzoElement(parseResult, {
 *   resolve: { baseURI: 'https://example.com/arazzo.json' },
 * });
 * ```
 *
 * @example
 * Resolve child element (e.g., WorkflowElement)
 * ```typescript
 * const parseResult = await parseArazzo('/path/to/arazzo.json');
 * const workflow = parseResult.api.workflows.get(0);
 * const refSet = await resolveArazzoElement(workflow, {
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
    throw new ResolveError('Failed to resolve Arazzo Document', { cause: error });
  }
}
