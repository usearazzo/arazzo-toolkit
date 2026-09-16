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
import Arazzo1ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/arazzo-1';
import OpenAPI2ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-2';
import OpenAPI30ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-0';
import OpenAPI31ResolveStrategy from '@speclynx/apidom-reference/resolve/strategies/openapi-3-1';
import { isArazzoSpecification1Element, mediaTypes } from '@speclynx/apidom-ns-arazzo-1';
import type { PartialDeep } from 'type-fest';

import { defaultOptions as dereferenceDefaultOptions } from '../dereference/arazzo.ts';
import ResolveError from '../errors/ResolveError.ts';

/**
 * Options for resolving Arazzo Documents.
 * @public
 */
export type Options = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default reference options for resolving Arazzo Documents.
 *
 * The resolve strategies delegate to the dereference strategies of the same name,
 * so the dereference defaults are carried over and only the resolve strategies are added.
 * @public
 */
export const defaultOptions: Options = {
  resolve: {
    resolvers: [...dereferenceDefaultOptions.resolve!.resolvers!],
    strategies: [
      new Arazzo1ResolveStrategy(),
      new OpenAPI2ResolveStrategy(),
      new OpenAPI30ResolveStrategy(),
      new OpenAPI31ResolveStrategy(),
    ],
  },
  parse: {
    parsers: [...dereferenceDefaultOptions.parse!.parsers!],
    parserOpts: { ...dereferenceDefaultOptions.parse!.parserOpts },
  },
  dereference: {
    strategies: [...dereferenceDefaultOptions.dereference!.strategies!],
    strategyOpts: { ...dereferenceDefaultOptions.dereference!.strategyOpts },
  },
};

/**
 * Resolves an Arazzo Document from a file system path or HTTP(S) URL.
 *
 * This function collects the Arazzo Document and every external document its
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced;
 * the root reference of the set holds the parsed entry document.
 *
 * The `dereference.refSet` option is ignored: resolving always builds a fresh ReferenceSet.
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
    const refSet = await resolveURI(retrievalURI, withoutSeededRefSet(mergedOptions));
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
 * JSON References ($ref) reach into a ReferenceSet. Nothing is dereferenced
 * and the element itself is left untouched.
 *
 * Supported scenarios:
 * - ParseResultElement with retrievalURI metadata: baseURI derived automatically
 * - ParseResultElement without retrievalURI: requires `options.resolve.baseURI`
 * - Child element (e.g., WorkflowElement) with parseResult in strategyOpts:
 *   requires `options.dereference.strategyOpts.parseResult`,
 *   and `options.resolve.baseURI` if parseResult lacks retrievalURI metadata
 * - Child element without parseResult: requires `options.resolve.baseURI` and
 *   `options.parse.mediaType`, since the element alone cannot identify the document kind
 *
 * For a child element the root reference of the returned set is keyed by the root document
 * URI but holds a ParseResultElement wrapping a copy of the child, not the root document.
 * The set describes the references reachable from the child and is not a whole-document set.
 *
 * The `dereference.refSet` option is ignored: resolving always builds a fresh ReferenceSet.
 *
 * @param element - An ApiDOM element (ParseResultElement or child element like WorkflowElement)
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the ReferenceSet of the element and its external references
 * @throws ResolveError - When baseURI is required but not provided, when the document is not an Arazzo specification, or when resolving fails
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
  const subject = isParseResultElement(element) ? 'a ParseResultElement' : 'a child element';
  // a child element resolves against the URI of its root document
  const root = isParseResultElement(element)
    ? element
    : mergedOptions.dereference?.strategyOpts?.parseResult;
  let baseURI = mergedOptions.resolve?.baseURI;
  let mediaType = mergedOptions.parse?.mediaType ?? 'text/plain';

  if (isParseResultElement(root)) {
    if (!isArazzoSpecification1Element(root.api)) {
      throw new ResolveError('Failed to resolve Arazzo Document', {
        cause: new UnmatchedResolveStrategyError(
          `Could not find a resolve strategy that can resolve ${subject} as an Arazzo specification`,
        ),
      });
    }
    mediaType = mergedOptions.parse?.mediaType ?? mediaTypes.latest();
    if (root.hasMetaProperty('retrievalURI')) {
      baseURI = root.meta.get('retrievalURI') as string;
    } else if (!baseURI) {
      throw new ResolveError(
        `baseURI option is required when resolving ${subject} without retrievalURI metadata`,
      );
    }
  } else if (!baseURI) {
    throw new ResolveError(
      'baseURI option is required when resolving a child element without parseResult in strategyOpts',
    );
  }

  try {
    return await resolveApiDOMElement(
      element,
      withoutSeededRefSet(
        mergeOptions(mergedOptions, {
          resolve: {
            baseURI,
          },
          parse: {
            mediaType,
          },
        }),
      ),
    );
  } catch (error: unknown) {
    throw new ResolveError('Failed to resolve Arazzo Document', { cause: error });
  }
}

/**
 * Drops a seeded `dereference.refSet`. The resolve strategies always build their own
 * ReferenceSet and deep-merge it over the option, which strips the prototype of a
 * caller-supplied instance and crashes the resolution.
 */
function withoutSeededRefSet(options: ApiDOMReferenceOptions): ApiDOMReferenceOptions {
  return mergeOptions(options, { dereference: { refSet: null } });
}
