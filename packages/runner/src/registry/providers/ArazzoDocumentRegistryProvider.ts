import { parseArazzo, defaultParseArazzoOptions } from '@usearazzo/parser';
import {
  readFile,
  File,
  mergeOptions,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import { UnmatchedResolverError } from '@speclynx/apidom-reference/configuration/empty';

import * as constants from '../../constants.ts';
import ArazzoDocument from '../../document/ArazzoDocument.ts';
import DocumentRegistryProvider, {
  circularReplacer,
  type DocumentRegistryProviderOptions,
} from './DocumentRegistryProvider.ts';

/**
 * Options for loading an Arazzo document.
 * @public
 */
export type ArazzoDocumentRegistryProviderOptions = DocumentRegistryProviderOptions;

/**
 * Default options for loading an Arazzo document.
 *
 * The provider only parses the Arazzo document; dereferencing is deferred
 * to the normalizer when a specific workflow is accessed.
 */
export const providerOptionsOverride: ArazzoDocumentRegistryProviderOptions = {
  resolve: {
    resolverOpts: {
      cache: {
        maxEntries: constants.MAX_HTTP_CACHE_ENTRIES,
        maxStaleAge: constants.MAX_HTTP_CACHE_STALE_AGE,
      },
    },
  },
  dereference: {
    immutable: false,
    circular: 'replace',
    circularReplacer,
    strategyOpts: {
      sourceDescriptions: false,
    },
  },
};

/**
 * Provides ArazzoDocument instances for the DocumentRegistry.
 *
 * Parses the Arazzo document; the document builds its own indexes from the
 * parse result at construction.
 * @public
 */
class ArazzoDocumentRegistryProvider extends DocumentRegistryProvider {
  readonly #options: ArazzoDocumentRegistryProviderOptions;

  constructor(options: ArazzoDocumentRegistryProviderOptions = {}) {
    super();
    this.#options = mergeOptions(providerOptionsOverride as ApiDOMReferenceOptions, options);
  }

  async canProvide(uri: string): Promise<boolean> {
    try {
      const options = this.#buildParseOptions();
      const data = await readFile(uri, options);
      const file = new File({ uri, data });
      const parsers = options.parse.parsers.filter((p) => p.name.startsWith('arazzo'));

      for (const parser of parsers) {
        if (await parser.canParse(file)) return true;
      }
    } catch (error: unknown) {
      if (error instanceof UnmatchedResolverError) return false;
      throw error;
    }

    return false;
  }

  /**
   * Loads an Arazzo document from a URI and produces an ArazzoDocument.
   */
  async provide(uri: string): Promise<ArazzoDocument> {
    const parseResult = await parseArazzo(uri, this.#buildParseOptions());

    return new ArazzoDocument(uri, parseResult);
  }

  #buildParseOptions(): ApiDOMReferenceOptions {
    return mergeOptions(defaultParseArazzoOptions as ApiDOMReferenceOptions, this.#options);
  }
}

export default ArazzoDocumentRegistryProvider;
