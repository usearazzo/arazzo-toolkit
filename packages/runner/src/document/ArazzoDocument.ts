import type { ParseResultElement } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import { filter } from '@speclynx/apidom-traverse';
import {
  isSourceDescriptionElement,
  type SourceDescriptionElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { url } from '@speclynx/apidom-reference/configuration/empty';

import APIDocument from './APIDocument.ts';
import type ArazzoWorkflowIndex from './ArazzoWorkflowIndex.ts';

/**
 * An Arazzo document held by the document registry.
 * @public
 */
class ArazzoDocument extends APIDocument {
  readonly type = 'arazzo' as const;
  isEntry: boolean;
  readonly workflowIndex: ArazzoWorkflowIndex;
  /**
   * Name → source description element, built eagerly at construction the way
   * {@link ArazzoDocument.workflowIndex} is: one traversal when the document
   * is created, map lookups ever after — a name is looked up repeatedly
   * within a run (per retry firing, per dependency validation), and the
   * source descriptions never change after parse. The first element of a
   * duplicated name wins, matching what a first-match traversal returned.
   */
  readonly #sourceDescriptionIndex = new Map<string, SourceDescriptionElement>();

  constructor(
    uri: string,
    parseResult: ParseResultElement,
    workflowIndex: ArazzoWorkflowIndex,
    isEntry = false,
  ) {
    super(uri, parseResult);
    this.isEntry = isEntry;
    this.workflowIndex = workflowIndex;
    filter(
      parseResult,
      (path) => isSourceDescriptionElement(path.node) && isStringElement(path.node.name),
    ).forEach((path) => {
      const sourceDescription = path.node as SourceDescriptionElement;
      const name = toValue(sourceDescription.name) as string;
      if (!this.#sourceDescriptionIndex.has(name)) {
        this.#sourceDescriptionIndex.set(name, sourceDescription);
      }
    });
  }

  /**
   * Type guard for ArazzoDocument.
   */
  static is(doc: APIDocument): doc is ArazzoDocument {
    return doc.type === 'arazzo';
  }

  /**
   * Resolves a source description name to its canonical URI.
   *
   * Looks up the name in this document's source description index and
   * resolves the url against this document's base URI.
   */
  resolveSourceDescriptionURI(sourceDescriptionName: string): string | undefined {
    const sourceDescription = this.#sourceDescriptionIndex.get(sourceDescriptionName);

    if (sourceDescription === undefined || !isStringElement(sourceDescription.url)) return;

    return url.sanitize(
      url.stripHash(url.resolve(this.uri, toValue(sourceDescription.url) as string)),
    );
  }

  /**
   * Resolves a field of a source description object (e.g. `url`, `type`).
   *
   * The `url` field resolves to the canonical URI (resolved against this
   * document's base URI, as `resolveSourceDescriptionURI` does); every other
   * field resolves to its literal value. Returns `undefined` when the source
   * description or the field is absent.
   */
  resolveSourceDescriptionField(sourceDescriptionName: string, field: string): unknown {
    if (field === 'url') return this.resolveSourceDescriptionURI(sourceDescriptionName);

    const sourceDescription = this.#sourceDescriptionIndex.get(sourceDescriptionName);
    if (sourceDescription === undefined) return undefined;

    return toValue(sourceDescription.get(field));
  }

  /**
   * The canonical URIs of this document's source descriptions, resolved against
   * this document's base URI, in declaration order. Sources without a resolvable
   * url are omitted.
   */
  sourceDescriptionURIs(): string[] {
    return [...this.#sourceDescriptionIndex.keys()]
      .map((name) => this.resolveSourceDescriptionURI(name))
      .filter((uri): uri is string => uri !== undefined);
  }
}

export default ArazzoDocument;
