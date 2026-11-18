import type { ParseResultElement } from '@usearazzo/parser';
import { toValue, toYAML } from '@speclynx/apidom-core';
import type { Element } from '@speclynx/apidom-datamodel';

/**
 * Where an element is written.
 * @public
 */
export interface DocumentLocation {
  /**
   * The document that defines the element: the one it came from when it was
   * reached through a reference (a workflow of another Arazzo document, an
   * operation of a Path Item Object written as a `$ref`), not necessarily the
   * entry document.
   */
  readonly uri: string;
  /**
   * The element's JSON Pointer in that document. Absent only for an element
   * whose pointer no one recorded: the runner records one for every element
   * an event locates.
   */
  readonly jsonPointer?: string;
  /**
   * The 1-based line and column, present only when the document was parsed
   * with source maps (`sourceMap` on `ArazzoRunner.load`).
   */
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
