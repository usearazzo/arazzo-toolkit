import type { ParseResultElement } from '@usearazzo/parser';
import { parseOpenAPI, defaultParseOpenAPIOptions } from '@usearazzo/parser';
import {
  dereferenceOpenAPIElement,
  defaultDereferenceOpenAPIOptions,
  resolveOpenAPIElement,
} from '@usearazzo/resolver';
import {
  isObjectElement,
  isParseResultElement,
  isStringElement,
  type Element,
} from '@speclynx/apidom-datamodel';
import { evaluate } from '@speclynx/apidom-json-pointer';
import {
  readFile,
  File,
  mergeOptions,
  url,
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

        const definition = await OpenAPIDocumentRegistryProvider.#definitionOf(
          pathItem,
          uri,
          parseResult,
          dereferenceOptions,
        );
        const pathItemDereferenced = await dereferenceOpenAPIElement(pathItem, dereferenceOptions);
        if (definition !== undefined) {
          OpenAPIDocumentRegistryProvider.#recordOperations(pathItemDereferenced, definition);
        }
        path.replaceWith(pathItemDereferenced);
      },

      OperationElement(path: Path) {
        const operation = path.node as OpenAPIOperationElement;
        const operationId = toValue(operation.operationId);
        const pointer = path.formatPath('jsonpointer');
        // where the operation is written, for the events to locate it by; an
        // operation of a `$ref` path item already has it recorded
        if (!operation.hasMetaProperty('json-pointer')) operation.meta.set('json-pointer', pointer);

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

  /**
   * Where the Path Item Object a `$ref` path item stands for is written: the
   * reference followed through every further `$ref` it lands on, across the
   * files it references. `undefined` when the chain cannot be followed (a
   * cycle, or a target outside the files the path item references).
   */
  static async #definitionOf(
    pathItem: OpenAPIPathItemElement,
    uri: string,
    parseResult: ParseResultElement,
    options: ApiDOMReferenceOptions,
  ): Promise<{ uri: string; jsonPointer: string } | undefined> {
    const references = await resolveOpenAPIElement(pathItem, options);
    const entry = url.sanitize(url.stripHash(uri));
    const visited = new Set<string>();
    let base = uri;
    let reference = toValue(pathItem.$ref) as string;

    for (;;) {
      const target = url.resolve(base, reference);
      if (visited.has(target)) return undefined;
      visited.add(target);

      const file = url.sanitize(url.stripHash(target));
      const jsonPointer = OpenAPIDocumentRegistryProvider.#decode(url.getHash(target).slice(1));
      const root = file === entry ? parseResult : references.find((ref) => ref.uri === file)?.value;
      const document = isParseResultElement(root) ? root.result : undefined;
      if (document === undefined) return undefined;

      let element: Element;
      try {
        element = evaluate<Element>(document, jsonPointer);
      } catch {
        return undefined;
      }
      const next = isObjectElement(element) ? element.get('$ref') : undefined;
      if (!isStringElement(next)) return { uri: file, jsonPointer };
      base = file;
      reference = toValue(next) as string;
    }
  }

  /**
   * Records, on each operation of a dereferenced path item, the document and
   * JSON Pointer it is written at, for the events to locate it by.
   */
  static #recordOperations(
    pathItem: Element,
    definition: { uri: string; jsonPointer: string },
  ): void {
    if (!isObjectElement(pathItem)) return;
    pathItem.forEach((value, key) => {
      if (value.element !== 'operation') return;
      value.meta.set('ref-origin', definition.uri);
      value.meta.set('json-pointer', `${definition.jsonPointer}/${toValue(key) as string}`);
    });
  }

  // a stray `%` the reference layer tolerated must not fail the load
  static #decode(fragment: string): string {
    try {
      return decodeURIComponent(fragment);
    } catch {
      return fragment;
    }
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
