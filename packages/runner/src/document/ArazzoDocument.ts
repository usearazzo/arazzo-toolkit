import type { ParseResultElement } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import { traverse, type Path } from '@speclynx/apidom-traverse';
import type { SourceDescriptionElement, WorkflowElement } from '@speclynx/apidom-ns-arazzo-1';
import { url } from '@speclynx/apidom-reference/configuration/empty';

import APIDocument from './APIDocument.ts';
import ArazzoWorkflowIndex from './ArazzoWorkflowIndex.ts';

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
  /**
   * WorkflowId → JSON Pointer to the workflow within the parse result.
   */
  readonly workflowIndex = new ArazzoWorkflowIndex();
  /**
   * Name → source description. A name is looked up repeatedly within a run
   * (per retry firing, per dependency validation), and the source
   * descriptions never change after parse. The canonical URI is resolved
   * here too: the base URI and the source's `url` are both fixed once the
   * document exists, so every entry carries a ready-to-use, non-relative
   * URI rather than a resolve deferred to each consumer. The first element
   * of a duplicated name wins, matching what a first-match traversal
   * returned.
   */
  readonly #sourceDescriptionIndex = new Map<string, SourceDescriptionEntry>();

  constructor(uri: string, parseResult: ParseResultElement, isEntry = false) {
    super(uri, parseResult);
    this.isEntry = isEntry;
    // both indexes derive from nothing but the parse result, so the document
    // builds them itself, in one traversal at construction — a document with
    // a mismatched index is not constructible.
    traverse(parseResult.api, {
      WorkflowElement: (path: Path) => {
        const workflow = path.node as WorkflowElement;
        const workflowId = toValue(workflow.workflowId);
        if (typeof workflowId === 'string' && workflowId !== '') {
          this.workflowIndex.set(workflowId, path.formatPath('jsonpointer'));
        }
        return path.skip();
      },
      SourceDescriptionElement: (path: Path) => {
        const element = path.node as SourceDescriptionElement;
        if (isStringElement(element.name)) {
          const name = toValue(element.name) as string;
          if (!this.#sourceDescriptionIndex.has(name)) {
            this.#sourceDescriptionIndex.set(name, {
              element,
              uri: isStringElement(element.url)
                ? url.sanitize(url.stripHash(url.resolve(uri, toValue(element.url) as string)))
                : undefined,
            });
          }
        }
        return path.skip();
      },
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
