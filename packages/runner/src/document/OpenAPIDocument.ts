import type { ParseResultElement } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';
import type { Element } from '@speclynx/apidom-datamodel';
import { evaluate } from '@speclynx/apidom-json-pointer';

import APIDocument, { type DocumentLocation } from './APIDocument.ts';
import type OpenAPIOperationIndex from './OpenAPIOperationIndex.ts';

/**
 * An OpenAPI document held by the document registry.
 * @public
 */
class OpenAPIDocument extends APIDocument {
  readonly type = 'openapi' as const;
  readonly operationIndex: OpenAPIOperationIndex;

  constructor(uri: string, parseResult: ParseResultElement, operationIndex: OpenAPIOperationIndex) {
    super(uri, parseResult);
    this.operationIndex = operationIndex;
  }

  /**
   * Where the operation at `jsonPointer` is written. The registry replaces a
   * Path Item Object written as a `$ref` with the one it references, so an
   * operation in it is located in the document the reference names, at the
   * reference's fragment.
   */
  operationLocation(operation: Element, jsonPointer: string): DocumentLocation {
    const methodAt = jsonPointer.lastIndexOf('/');
    const pathItem = evaluate<Element>(this.parseResult.api!, jsonPointer.slice(0, methodAt));
    const origin = toValue(pathItem.meta.get('ref-origin'));
    const reference = (toValue(pathItem.meta.get('ref-fields')) as { $ref?: unknown } | undefined)
      ?.$ref;
    const location = this.locationOf(operation, jsonPointer);
    if (typeof origin !== 'string' || typeof reference !== 'string') return location;

    const hashAt = reference.indexOf('#');
    const fragment = hashAt === -1 ? '' : OpenAPIDocument.#decode(reference.slice(hashAt + 1));
    return { ...location, uri: origin, jsonPointer: `${fragment}${jsonPointer.slice(methodAt)}` };
  }

  // a stray `%` the reference layer tolerated must not fail the run that is
  // being observed
  static #decode(fragment: string): string {
    try {
      return decodeURIComponent(fragment);
    } catch {
      return fragment;
    }
  }

  /**
   * Type guard for OpenAPIDocument.
   */
  static is(doc: APIDocument): doc is OpenAPIDocument {
    return doc.type === 'openapi';
  }
}

export default OpenAPIDocument;
