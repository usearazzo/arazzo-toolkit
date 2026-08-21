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
 * One indexed source description: the parsed element and its canonical URI —
 * already resolved against the owning document's base URI, in the exact form
 * the document registry keys on — or `undefined` for a source with no
 * resolvable `url`.
 */
interface SourceDescriptionEntry {
  readonly element: SourceDescriptionElement;
  readonly uri: string | undefined;
}

/**
 * An Arazzo document held by the document registry.
 * @public
 */
class ArazzoDocument extends APIDocument {
  readonly type = 'arazzo' as const;
  isEntry: boolean;
  readonly workflowIndex: ArazzoWorkflowIndex;
  /**
   * Name → source description, built eagerly at construction the way
   * {@link ArazzoDocument.workflowIndex} is: one traversal when the document
   * is created, map lookups ever after — a name is looked up repeatedly
   * within a run (per retry firing, per dependency validation), and the
   * source descriptions never change after parse. The canonical URI is
   * resolved here too, for the same reason: the base URI and the source's
   * `url` are both fixed once the document exists, so every entry is a
   * ready-to-use, non-relative URI rather than a resolve deferred to each
   * consumer. The first element of a duplicated name wins, matching what a
   * first-match traversal returned.
   */
  readonly #sourceDescriptionIndex = new Map<string, SourceDescriptionEntry>();

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
      const element = path.node as SourceDescriptionElement;
      const name = toValue(element.name) as string;
      if (this.#sourceDescriptionIndex.has(name)) return;

      this.#sourceDescriptionIndex.set(name, {
        element,
        uri: isStringElement(element.url)
          ? url.sanitize(url.stripHash(url.resolve(uri, toValue(element.url) as string)))
          : undefined,
      });
    });
  }

  /**
   * Type guard for ArazzoDocument.
   */
  static is(doc: APIDocument): doc is ArazzoDocument {
    return doc.type === 'arazzo';
  }

  /**
   * Resolves a source description name to its canonical URI — precomputed at
   * construction, resolved against this document's base URI.
   */
  resolveSourceDescriptionURI(sourceDescriptionName: string): string | undefined {
    return this.#sourceDescriptionIndex.get(sourceDescriptionName)?.uri;
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
    const sourceDescription = this.#sourceDescriptionIndex.get(sourceDescriptionName);
    if (sourceDescription === undefined) return undefined;
    if (field === 'url') return sourceDescription.uri;

    return toValue(sourceDescription.element.get(field));
  }

  /**
   * The canonical URIs of this document's source descriptions, resolved against
   * this document's base URI, in declaration order. Sources without a resolvable
   * url are omitted.
   */
  sourceDescriptionURIs(): string[] {
    return [...this.#sourceDescriptionIndex.values()]
      .map((entry) => entry.uri)
      .filter((uri): uri is string => uri !== undefined);
  }
}

export default ArazzoDocument;
