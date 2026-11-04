import type { ParseResultElement } from '@usearazzo/parser';
import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import { evaluate, type JSONPointer } from '@speclynx/apidom-json-pointer';
import type { WorkflowElement } from '@speclynx/apidom-ns-arazzo-1';

import APIDocument from './APIDocument.ts';
import type ArazzoWorkflowIndex from './ArazzoWorkflowIndex.ts';
import type { WorkflowId } from './ArazzoWorkflowIndex.ts';
import type ArazzoStepIndex from './ArazzoStepIndex.ts';
import type ArazzoSourceDescriptionIndex from './ArazzoSourceDescriptionIndex.ts';

/**
 * A workflow of an Arazzo document, as listed by
 * {@link ArazzoDocument.listWorkflows}.
 * @public
 */
export interface WorkflowDescriptor {
  workflowId: WorkflowId;
  /**
   * JSON Pointer to the workflow within the document.
   */
  jsonPointer: JSONPointer;
  /**
   * Present only when the workflow has a string `summary`.
   */
  summary?: string;
  /**
   * Present only when the workflow has a string `description`, as written
   * (CommonMark).
   */
  description?: string;
}

/**
 * An Arazzo document held by the document registry: the parse result together
 * with the indexes the provider built over it — a container, not a logic
 * bearer. The methods below are thin reads of those indexes.
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
   * WorkflowId → stepId → JSON Pointer to the step within the parse result.
   * Built by the provider, like {@link ArazzoDocument.workflowIndex}.
   */
  readonly stepIndex: ArazzoStepIndex;
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
    stepIndex: ArazzoStepIndex,
    sourceDescriptionIndex: ArazzoSourceDescriptionIndex,
    isEntry = false,
  ) {
    super(uri, parseResult);
    this.isEntry = isEntry;
    this.workflowIndex = workflowIndex;
    this.stepIndex = stepIndex;
    this.sourceDescriptionIndex = sourceDescriptionIndex;
  }

  /**
   * Type guard for ArazzoDocument.
   */
  static is(doc: APIDocument): doc is ArazzoDocument {
    return doc.type === 'arazzo';
  }

  /**
   * The workflows of this document that can be addressed by `workflowId`, in
   * document order. Reads this document only: source descriptions are neither
   * loaded nor listed.
   */
  listWorkflows(): WorkflowDescriptor[] {
    return [...this.workflowIndex].map(([workflowId, jsonPointer]) => {
      const { summary, description } = evaluate<WorkflowElement>(this.parseResult.api, jsonPointer);

      return {
        workflowId,
        jsonPointer,
        ...(isStringElement(summary) && { summary: toValue(summary) as string }),
        ...(isStringElement(description) && { description: toValue(description) as string }),
      };
    });
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
