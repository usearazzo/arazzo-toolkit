import type { ParseResultElement } from '@usearazzo/parser';
import { parseOpenAPI, defaultParseOpenAPIOptions } from '@usearazzo/parser';
import { dereferenceOpenAPIElement, defaultDereferenceOpenAPIOptions } from '@usearazzo/resolver';
import { isStringElement, type Element, type MemberElement } from '@speclynx/apidom-datamodel';
import {
  readFile,
  File,
  mergeOptions,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import { UnmatchedResolverError } from '@speclynx/apidom-reference/configuration/empty';
import { traverseAsync, type Path } from '@speclynx/apidom-traverse';
import { toValue } from '@speclynx/apidom-core';

import type {
  OpenAPIPathItemElement,
  OpenAPIOperationElement,
} from '../../document/openapi-types.ts';
import * as constants from '../../constants.ts';
import OpenAPIDocument from '../../document/OpenAPIDocument.ts';
import DocumentRegistryProvider, {
  circularReplacer,
  type DocumentRegistryProviderOptions,
} from './DocumentRegistryProvider.ts';
import OpenAPIOperationIndex from '../../document/OpenAPIOperationIndex.ts';

/**
 * Options for loading an OpenAPI document.
 * @public
 */
export type OpenAPIDocumentRegistryProviderOptions = DocumentRegistryProviderOptions;

/**
 * Default options for loading an OpenAPI document.
 */
export const providerOptionsOverride: OpenAPIDocumentRegistryProviderOptions = {
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
  },
};

/**
 * Provides OpenAPIDocument instances for the DocumentRegistry.
 *
 * Parses, dereferences, and builds an OperationIndex for OpenAPI documents.
 * The first operation of a duplicated operationId wins.
 * @public
 */
class OpenAPIDocumentRegistryProvider extends DocumentRegistryProvider {
  override readonly sourceDescriptionType = 'openapi';

  readonly #options: OpenAPIDocumentRegistryProviderOptions;

  constructor(options: OpenAPIDocumentRegistryProviderOptions = {}) {
    super();
    this.#options = mergeOptions(providerOptionsOverride as ApiDOMReferenceOptions, options);
  }

  async canProvide(uri: string): Promise<boolean> {
    try {
      const options = this.#buildParseOptions();
      const data = await readFile(uri, options);
      const file = new File({ uri, data });
      const parsers = options.parse.parsers.filter((p) => p.name.startsWith('openapi'));

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
   * Loads an OpenAPI document from a URI and produces an OpenAPIDocument.
   */
  async provide(uri: string): Promise<OpenAPIDocument> {
    const parseResult: ParseResultElement = await parseOpenAPI(uri, this.#buildParseOptions());
    this.assertParsed(uri, parseResult);
    const operationIndex = await this.#buildOperationIndex(uri, parseResult);

    return new OpenAPIDocument(uri, parseResult, operationIndex);
  }

  async #buildOperationIndex(
    uri: string,
    parseResult: ParseResultElement,
  ): Promise<OpenAPIOperationIndex> {
    const index = new OpenAPIOperationIndex();
    const dereferenceOptions = this.#buildDereferenceOptions(parseResult);

    const apiDereferenced = await traverseAsync(parseResult.api, {
      async PathItemElement(path: Path) {
        const pathItem = path.node as OpenAPIPathItemElement;

        if (!pathItem.hasMetaProperty('path')) return path.skip();
        if (!isStringElement(pathItem.$ref)) return;

        path.replaceWith(await dereferenceOpenAPIElement(pathItem, dereferenceOptions));
      },

      OperationElement(path: Path) {
        const operation = path.node as OpenAPIOperationElement;
        const operationId = toValue(operation.operationId);
        const pointer = path.formatPath('jsonpointer');
        // where the operation is written, for the events to locate it by: an
        // operation of a `$ref` path item is written where that path item is
        const member = path.parentPath?.node as MemberElement;
        const pathItem = path.parentPath?.parentPath?.node as Element;
        const definition = toValue(pathItem.meta.get('ref-origin-pointer'));
        if (typeof definition === 'string') {
          operation.meta.set('ref-origin', toValue(pathItem.meta.get('ref-origin')));
          operation.meta.set('json-pointer', `${definition}/${toValue(member.key) as string}`);
        } else {
          operation.meta.set('json-pointer', pointer);
        }

        if (typeof operationId !== 'string') return path.skip();
        if (operationId === '') return path.skip();
        if (index.has(operationId)) return path.skip();

        index.set(operationId, pointer);

        path.skip();
      },
    });

    parseResult.replaceResult(apiDereferenced!);

    return index;
  }

  #buildParseOptions(): ApiDOMReferenceOptions {
    return mergeOptions(defaultParseOpenAPIOptions as ApiDOMReferenceOptions, this.#options);
  }

  #buildDereferenceOptions(parseResult?: ParseResultElement): ApiDOMReferenceOptions {
    let options = mergeOptions(
      defaultDereferenceOpenAPIOptions as ApiDOMReferenceOptions,
      this.#options,
    );
    if (parseResult) {
      options = mergeOptions(options, {
        dereference: { strategyOpts: { parseResult } },
      });
    }
    return options;
  }
}

export default OpenAPIDocumentRegistryProvider;
