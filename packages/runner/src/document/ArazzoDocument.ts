import type { ParseResultElement } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';

import APIDocument from './APIDocument.ts';
import type ArazzoWorkflowIndex from './ArazzoWorkflowIndex.ts';
import type ArazzoSourceDescriptionIndex from './ArazzoSourceDescriptionIndex.ts';

/**
 * An Arazzo document held by the document registry: the parse result together
 * with the indexes the provider built over it — a container, not a logic
 * bearer. The methods below are thin reads of the source description index.
 * @public
 */
class ArazzoDocument extends APIDocument {
  readonly type = 'arazzo' as const;
  isEntry: boolean;
  /**
   * WorkflowId → JSON Pointer to the workflow within the parse result.
   */
  readonly workflowIndex: ArazzoWorkflowIndex;
  /**
   * Name → source description element and canonical URI (already resolved
   * against this document's base URI). Built by the provider, like
   * {@link ArazzoDocument.workflowIndex}.
   */
  readonly sourceDescriptionIndex: ArazzoSourceDescriptionIndex;

  constructor(
    uri: string,
    parseResult: ParseResultElement,
    workflowIndex: ArazzoWorkflowIndex,
    sourceDescriptionIndex: ArazzoSourceDescriptionIndex,
    isEntry = false,
  ) {
    super(uri, parseResult);
    this.isEntry = isEntry;
    this.workflowIndex = workflowIndex;
    this.sourceDescriptionIndex = sourceDescriptionIndex;
  }

  /**
   * Type guard for ArazzoDocument.
   */
  static is(doc: APIDocument): doc is ArazzoDocument {
    return doc.type === 'arazzo';
  }

  /**
   * Resolves a source description name to its canonical URI — precomputed by
   * the provider, resolved against this document's base URI.
   */
  resolveSourceDescriptionURI(sourceDescriptionName: string): string | undefined {
    return this.sourceDescriptionIndex.get(sourceDescriptionName)?.uri;
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
    const sourceDescription = this.sourceDescriptionIndex.get(sourceDescriptionName);
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
    return [...this.sourceDescriptionIndex.values()]
      .map((entry) => entry.uri)
      .filter((uri): uri is string => uri !== undefined);
  }
}

export default ArazzoDocument;
