import { parse as parseRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';

import ArazzoDocument from '../document/ArazzoDocument.ts';
import type DocumentRegistry from '../registry/DocumentRegistry.ts';
import ExecutionError from '../errors/ExecutionError.ts';

/**
 * A canonical Arazzo workflow locator: the Arazzo document that owns the
 * workflow and the workflow's id within it.
 *
 * A workflow reference names its target in one of two ways — a plain
 * `workflowId` of the current document, or a
 * `$sourceDescriptions.{name}.{workflowId}` runtime expression naming a
 * workflow of another Arazzo document. Both are locators for the same thing;
 * the normalizer reduces either to this single canonical form.
 * @public
 */
export interface ArazzoWorkflowLocator {
  readonly document: ArazzoDocument;
  readonly workflowId: string;
}

/**
 * A workflow reference, parsed but not yet resolved: either a plain id of the
 * referencing document, or a `$sourceDescriptions.{name}.{workflowId}`
 * expression into a named source. `workflowId` is the bare id either way —
 * the key run state (`$workflows.{id}`) is recorded under, which the
 * runtime-expression grammar can only express unqualified.
 * @public
 */
export type ParsedWorkflowReference =
  | { readonly kind: 'local'; readonly workflowId: string }
  | { readonly kind: 'sourced'; readonly sourceName: string; readonly workflowId: string };

/**
 * The referencing context a reference is resolved in: the workflow (and step,
 * when the reference sits on one) making the reference, stamped onto every
 * error, and the run's document ledger.
 * @public
 */
export interface WorkflowReferenceContext {
  /**
   * The Arazzo documents already in use by this run, keyed by canonical URI.
   * Consulted before the registry and extended with every document a
   * reference resolves to — holding a direct reference for the rest of the
   * run keeps the document alive even if the registry's LRU cache evicts it
   * while the run is in flight.
   */
  readonly documents: Map<string, ArazzoDocument>;
  /**
   * The workflow the reference appears in.
   */
  readonly workflowId: string;
  /**
   * The step the reference appears on, when it sits on one (a sub-workflow
   * step's `workflowId`, or a `retry` / `goto` action's reference).
   */
  readonly stepId?: string;
}

/**
 * Normalizes a workflow reference to a canonical {@link ArazzoWorkflowLocator}
 * — the Arazzo document and the workflow's id within it.
 *
 * A reference appears in four author-facing positions — a sub-workflow step's
 * `workflowId`, a `dependsOn` entry, a `retry` action's `workflowId`
 * reference, and a `goto` action's transfer target — and is either a plain id
 * of the referencing document or a whole
 * `$sourceDescriptions.{name}.{workflowId}` runtime expression naming a
 * workflow of another Arazzo document. Only that dotted expression form is a
 * workflow reference; the resolver package's
 * `$sourceDescriptions.{name}#/json/pointer` form is a `$ref`-time construct,
 * not a runtime expression, and does not parse here.
 *
 * The `type` declared on a source description is not trusted (it may be
 * absent or wrong); a source is classified by what it actually parses to,
 * the same convention the OpenAPI operation locator follows. Source
 * documents are acquired from the registry on demand, through the run's
 * document ledger.
 * @public
 */
class ArazzoWorkflowLocatorNormalizer {
  readonly #registry: DocumentRegistry;

  constructor(registry: DocumentRegistry) {
    this.#registry = registry;
  }

  /**
   * Parses a reference to its target — without resolving it, so callers that
   * only need the bare workflowId (state keys, the prior `$workflows` entry a
   * retry pins) get it synchronously, before any document is acquired.
   *
   * A reference starting with `$` must be a whole
   * `$sourceDescriptions.{name}.{workflowId}` expression; anything else
   * `$`-prefixed (another expression kind, or one that does not parse) is a
   * malformed reference, rejected here rather than looked up as a literal id
   * that cannot exist.
   */
  parseReference(
    reference: string,
    { workflowId, stepId }: { workflowId: string; stepId?: string },
  ): ParsedWorkflowReference {
    if (!reference.startsWith('$')) {
      return { kind: 'local', workflowId: reference };
    }

    const { result, tree } = parseRuntimeExpression(reference);
    if (!result.success || tree.type !== 'SourceDescriptionsExpression') {
      throw new ExecutionError(
        `workflow reference "${reference}" in workflow "${workflowId}" is not a $sourceDescriptions.{name}.{workflowId} expression`,
        { workflowId, stepId, reason: 'invalid-workflow-reference' },
      );
    }
    const { sourceName, reference: sourcedWorkflowId } = tree;
    return { kind: 'sourced', sourceName, workflowId: sourcedWorkflowId };
  }

  /**
   * Resolves a reference to the Arazzo document that owns the target workflow.
   *
   * A plain id resolves to the referencing document itself. An expression
   * resolves its named source description to a URI, acquires that document
   * (through the run ledger first — see
   * {@link WorkflowReferenceContext.documents}), and requires it to actually
   * be an Arazzo document. Whether the document then *defines* the workflow
   * is deliberately left to the caller, which owns the timing of that check
   * (eager for a `dependsOn` list validated before any prerequisite runs,
   * lazy for a sub-workflow step resolved per attempt).
   */
  async normalize(
    reference: string,
    document: ArazzoDocument,
    context: WorkflowReferenceContext,
  ): Promise<ArazzoWorkflowLocator> {
    const parsed = this.parseReference(reference, context);
    if (parsed.kind === 'local') {
      return { document, workflowId: parsed.workflowId };
    }

    const { workflowId, stepId } = context;
    const uri = document.resolveSourceDescriptionURI(parsed.sourceName);
    if (uri === undefined) {
      throw new ExecutionError(
        `workflow reference "${reference}" in workflow "${workflowId}" names source description "${parsed.sourceName}", which the Arazzo document at "${document.uri}" does not define`,
        { workflowId, stepId, reason: 'source-description-not-found' },
      );
    }

    const ledgered = context.documents.get(uri);
    const source = ledgered ?? (await this.#registry.acquire(uri));
    if (!ArazzoDocument.is(source)) {
      throw new ExecutionError(
        `workflow reference "${reference}" in workflow "${workflowId}" names source description "${parsed.sourceName}" at "${uri}", which is not an Arazzo document`,
        { workflowId, stepId, reason: 'source-description-not-arazzo' },
      );
    }
    context.documents.set(uri, source);

    return { document: source, workflowId: parsed.workflowId };
  }
}

export default ArazzoWorkflowLocatorNormalizer;
