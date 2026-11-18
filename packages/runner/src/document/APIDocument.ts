import type { ParseResultElement } from '@usearazzo/parser';
import { toValue, toYAML } from '@speclynx/apidom-core';
import type { Element } from '@speclynx/apidom-datamodel';

/**
 * Where an element is written: the document that defines it, its JSON
 * Pointer there, and, when the document was parsed with source maps, its line
 * and column (1-based).
 * @public
 */
export interface DocumentLocation {
  readonly uri: string;
  /**
   * Absent for an element whose pointer the registry could not record, such
   * as one transcluded from a file it never loaded.
   */
  readonly jsonPointer?: string;
  readonly line?: number;
  readonly column?: number;
}

/**
 * Base document held by the document registry.
 * @public
 */
abstract class APIDocument {
  abstract readonly type: string;
  readonly uri: string;
  readonly parseResult: ParseResultElement;

  protected constructor(uri: string, parseResult: ParseResultElement) {
    this.uri = uri;
    this.parseResult = parseResult;
  }

  /**
   * Where an element of this document, or one it references, is written. An
   * element that came through a reference is located in the document it came
   * from (its `ref-origin`), at the pointer the registry recorded for it when
   * it loaded that document; `jsonPointer` stands in when none was recorded.
   */
  locationOf(element: Element, jsonPointer?: string): DocumentLocation {
    const origin = toValue(element.meta.get('ref-origin'));
    const recorded = toValue(element.meta.get('json-pointer'));
    const pointer = typeof recorded === 'string' ? recorded : jsonPointer;
    return {
      uri: typeof origin === 'string' ? origin : this.uri,
      ...(pointer === undefined ? {} : { jsonPointer: pointer }),
      ...(element.startLine === undefined || element.startCharacter === undefined
        ? {}
        : { line: element.startLine + 1, column: element.startCharacter + 1 }),
    };
  }

  /**
   * Returns a JSON-serializable representation of the document's API element.
   * Compatible with JSON.stringify() — JSON.stringify(doc) produces correct output.
   */
  toJSON(): unknown {
    return toValue(this.parseResult.api!);
  }

  /**
   * Serializes the document's API element to a YAML string.
   */
  toYAML(...args: Parameters<typeof toYAML> extends [unknown, ...infer R] ? R : []): string {
    return toYAML(this.parseResult.api!, ...args);
  }
}

export default APIDocument;
