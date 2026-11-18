import type { PartialDeep } from 'type-fest';
import type { ApiDOMReferenceOptions } from '@speclynx/apidom-reference/configuration/empty';
import { ObjectElement, type RefElement } from '@speclynx/apidom-datamodel';
import { toValue } from '@speclynx/apidom-core';
import { ParseError, type ParseResultElement } from '@usearazzo/parser';

import type APIDocument from '../../document/APIDocument.ts';

/**
 * Replaces circular $ref references with an empty ObjectElement
 * annotated with the original $ref value. This ensures the dereferenced
 * output is a finite tree safe for downstream tools.
 * @param ref - The RefElement being replaced at the cycle boundary.
 * @public
 */
export const circularReplacer = (ref: RefElement) =>
  new ObjectElement({ 'x-circular': ref.meta.get('$ref') });

/**
 * Options for a document registry provider.
 * @public
 */
export type DocumentRegistryProviderOptions = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Base class for document registry providers.
 *
 * Subclasses implement `canProvide()` for format detection and `provide()` for loading.
 * @public
 */
abstract class DocumentRegistryProvider {
  /**
   * The Source Description Object `type` this provider loads (`openapi`,
   * `arazzo`, …), or `undefined` when it does not say — then it may load a
   * source of any type.
   *
   * Lets the registry tell, without fetching anything, whether a source of a
   * given type can be loaded at all (`DocumentRegistry.canLoad`).
   */
  readonly sourceDescriptionType?: string;

  /**
   * Checks if the content at the URI can be handled by this provider.
   */
  abstract canProvide(uri: string): Promise<boolean>;

  /**
   * Loads and produces a document from a URI.
   */
  abstract provide(uri: string): Promise<APIDocument>;

  /**
   * Rejects a document the parser could only partly read. The strict parsers
   * throw on a syntax error; the lenient ones that source maps need record it
   * and parse what they can instead, so a document must load with source maps
   * exactly when it loads without.
   */
  protected static assertParsed(uri: string, parseResult: ParseResultElement): void {
    const [error] = parseResult.errors;
    if (error === undefined) return;
    throw new ParseError(`Failed to parse the document at "${uri}": ${toValue(error)}`);
  }
}

export default DocumentRegistryProvider;
