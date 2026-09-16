import { ParseResultElement } from '@speclynx/apidom-datamodel';
import {
  url,
  bundle as bundleURI,
  mergeOptions,
  UnmatchedBundleStrategyError,
} from '@speclynx/apidom-reference/configuration/empty';
import type { ApiDOMReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import Arazzo1BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/arazzo-1';
import OpenAPI2BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-2';
import OpenAPI30BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-3-0';
import OpenAPI31BundleStrategy from '@speclynx/apidom-reference/bundle/strategies/openapi-3-1';
import { isArazzoSpecification1Element } from '@speclynx/apidom-ns-arazzo-1';
import type { PartialDeep } from 'type-fest';

import { defaultOptions as dereferenceDefaultOptions } from '../dereference/arazzo.ts';
import BundleError from '../errors/BundleError.ts';

/**
 * Options for bundling Arazzo Documents.
 * @public
 */
export type Options = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default reference options for bundling Arazzo Documents.
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
      new Arazzo1BundleStrategy(),
      new OpenAPI2BundleStrategy(),
      new OpenAPI30BundleStrategy(),
      new OpenAPI31BundleStrategy(),
    ],
  },
};

/**
 * Bundles an Arazzo Document from a file system path or HTTP(S) URL.
 *
 * This function embeds every external JSON Schema resource reached through
 * JSON References ($ref) into the Components Object of the Arazzo Document,
 * producing a single compound document.
 *
 * @param uri - A file system path or HTTP(S) URL to the Arazzo Document
 * @param options - Reference options (uses defaultOptions when not provided)
 * @returns A promise that resolves to the bundled Arazzo Document as ApiDOM element
 * @throws BundleError - When bundling fails or document is not an Arazzo specification. The original error is available via the `cause` property.
 *
 * @example
 * // Bundle from file
 * const result = await bundleArazzo('/path/to/arazzo.json');
 *
 * @example
 * // Bundle from URL
 * const result = await bundleArazzo('https://example.com/arazzo.yaml');
 *
 * @example
 * // Bundle with custom options
 * const result = await bundleArazzo('/path/to/arazzo.json', customReferenceOptions);
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

    // validate that the bundled document is an Arazzo specification
    if (!isArazzoSpecification1Element(parseResult.api)) {
      throw new UnmatchedBundleStrategyError(
        `Could not find a bundle strategy that can bundle "${uri}" as an Arazzo specification`,
      );
    }

    parseResult.meta.set('retrievalURI', retrievalURI);
    return parseResult;
  } catch (error: unknown) {
    throw new BundleError(`Failed to bundle Arazzo Document at "${uri}"`, {
      cause: error,
    });
  }
}
