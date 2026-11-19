import type { ParseResultElement } from '@usearazzo/parser';
import { toValue, toYAML } from '@speclynx/apidom-core';
import type { Element } from '@speclynx/apidom-datamodel';

/**
 * A position in a document, as in the Language Server Protocol: a 0-based
 * line, and a 0-based character offset within it in UTF-16 code units.
 * @public
 */
export interface DocumentPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * A range in a document, as in the Language Server Protocol: from `start` to
 * `end`, the shape the validator's diagnostics use.
 * @public
 */
export interface DocumentRange {
  readonly start: DocumentPosition;
  readonly end: DocumentPosition;
}

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
   * The element's range in that document, present only when the document was
   * parsed with source maps (`sourceMap` on `ArazzoRunner.load`).
   */
  readonly range?: DocumentRange;
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
   * Where an element of this document, or one it references, is written, as
   * the registry provider recorded it when it loaded the document: the
   * document it came from (its `ref-origin`) when it came through a
   * reference, and its JSON Pointer there.
   */
  locationOf(element: Element): DocumentLocation {
    const origin = toValue(element.meta.get('ref-origin'));
    const jsonPointer = toValue(element.meta.get('json-pointer'));
    const { startLine, startCharacter, endLine, endCharacter } = element;

    return {
      uri: typeof origin === 'string' ? origin : this.uri,
      ...(typeof jsonPointer === 'string' && { jsonPointer }),
      // a source-mapped parse positions every element fully, any other none
      ...(startLine !== undefined && {
        range: {
          start: { line: startLine, character: startCharacter! },
          end: { line: endLine!, character: endCharacter! },
        },
      }),
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
