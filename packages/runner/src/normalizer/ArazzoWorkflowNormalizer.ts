import { uniqWith } from 'ramda';
import {
  isParameterElement,
  isStepElement,
  StepParametersElement,
  type WorkflowElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isStringElement } from '@speclynx/apidom-datamodel';
import { dereferenceArazzoElement, defaultDereferenceArazzoOptions } from '@usearazzo/resolver';
import {
  mergeOptions,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import type { PartialDeep } from 'type-fest';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import ParameterIdentity from '../document/ParameterIdentity.ts';
import NormalizationError from '../errors/NormalizationError.ts';
import { providerOptionsOverride as arazzoProviderOptions } from '../registry/providers/ArazzoDocumentRegistryProvider.ts';

/**
 * Options for normalizing an Arazzo workflow.
 * @public
 */
export type ArazzoWorkflowNormalizerOptions = PartialDeep<ApiDOMReferenceOptions>;

/**
 * Default options for normalizing an Arazzo workflow.
 */
// shallow copy to avoid mutating the provider's shared options
const normalizerOptionsOverride = mergeOptions(arazzoProviderOptions as ApiDOMReferenceOptions, {});

/**
 * Normalizes an extracted Arazzo workflow.
 *
 * Dereferences the workflow subtree ($components.* references),
 * producing a self-contained workflow element, then inherits the
 * workflow's `parameters` into each of its steps.
 *
 * Both steps mutate, and what they mutate is the document itself: the extractor
 * hands over the live workflow node out of `document.parseResult`, and
 * dereferencing runs `immutable: false`, returning that same instance. Writing
 * through to the document is what lets the registry act as a natural cache —
 * a workflow reached a second time is already dereferenced and already
 * inherited into, so neither pass repeats. The inheritance is idempotent for
 * exactly that reason.
 *
 * The two writes differ in kind, which is worth knowing before sharing a
 * registry. Dereferencing only *resolves* what the document already says — a
 * `$ref` replaced by its target means the same thing. Inheritance *synthesizes*:
 * afterwards a step carries `parameters` its source never declared, so a
 * consumer that reads the document back (`APIDocument.toJSON()`) sees one that
 * no longer matches the file it was parsed from. The OpenAPI normalizers write
 * inherited servers, parameters and security requirements into their documents
 * the same way, so this is the layer's established contract rather than a
 * property of Arazzo.
 * @public
 */
class ArazzoWorkflowNormalizer {
  readonly #options: ApiDOMReferenceOptions;

  constructor(options: ArazzoWorkflowNormalizerOptions = {}) {
    this.#options = mergeOptions(normalizerOptionsOverride as ApiDOMReferenceOptions, options);
  }

  /**
   * Dereferences the workflow subtree against its parent document, then inherits
   * the workflow's `parameters` into its steps.
   */
  async normalize(workflow: WorkflowElement, document: ArazzoDocument): Promise<WorkflowElement> {
    let dereferenced: WorkflowElement;

    try {
      dereferenced = await dereferenceArazzoElement(
        workflow,
        mergeOptions(
          defaultDereferenceArazzoOptions as ApiDOMReferenceOptions,
          mergeOptions(this.#options, {
            resolve: { baseURI: document.uri },
            dereference: {
              strategyOpts: { parseResult: document.parseResult },
            },
          }),
        ),
      );
    } catch (error: unknown) {
      throw new NormalizationError(
        `Failed to normalize workflow "${toValue(workflow.workflowId)}" in Arazzo document at "${document.uri}"`,
        { cause: error, workflowId: toValue(workflow.workflowId), uri: document.uri },
      );
    }

    // normalization (mutable) — after dereferencing, so a `parameters` list
    // reaching the steps through a $components reference is inherited as a
    // resolved Parameter Object rather than as the Reference Object it was
    // written as.
    this.#inheritParametersToSteps(dereferenced);

    return dereferenced;
  }

  /**
   * Inherits the workflow's `parameters` into each of its steps.
   *
   * Per Arazzo 1.0.1 a workflow's `parameters` are "applicable for all steps
   * described under this workflow" and a step's own definition "will override it
   * but can never remove it" — so each step ends up with the union, its own
   * declaration winning wherever the two are the same parameter by
   * {@link ParameterIdentity}. `uniqWith` keeps the first of each equal pair,
   * so the step's own list leads, exactly as `inheritParametersToOperation`
   * orders an Operation's ahead of the Path Item's it inherits.
   *
   * That leading position is what makes the override effective and not merely
   * present: the parameter resolvers key resolved values first-wins — by the
   * same `(name, in)` identity for an operation step
   * ({@link OpenAPIOperationParameterResolver}), and by bare name for a
   * `workflowId` step's inputs ({@link WorkflowParameterResolver}) — so
   * wherever the two collapse to one key, the earlier survives, which must be
   * the step's.
   *
   * Inheriting the elements here rather than the resolved values is what lets a
   * workflow-level `value` that is a runtime expression still be evaluated once
   * per step, against the state that step is entered with.
   *
   * Not every workflow parameter is applicable to every kind of step: one
   * without a location is a workflow-input mapping (see
   * {@link ParameterIdentity}), so it is inherited only into steps targeting a
   * `workflowId` — on an operation step it names no place in a request, and
   * the resolver reports a location-less parameter there as the step's *own*
   * authoring error, which not synthesizing one is what keeps true. The
   * workflow's own `parameters` list is left intact; only the synthesized
   * per-step copies are filtered.
   *
   * A malformed `steps` or `parameters` is left for the executor to report as
   * the authoring error it is; there is nothing to inherit through it here, and
   * a step whose own `parameters` is present but not a list is skipped rather
   * than handed a synthesized one — overwriting it would erase the very thing
   * that makes the document invalid and leave nothing to report. An entry
   * *within* either list that is not a Parameter Object is carried across
   * untouched rather than filtered out, for the same reason: rebuilding a step's
   * list is no licence to drop what its author wrote, and the parameter
   * resolvers ignore it anyway. A parameter whose location is malformed (`in: 1`) is
   * likewise carried, for the resolver to report loudly.
   */
  #inheritParametersToSteps(workflow: WorkflowElement): void {
    const inherited = workflow.parameters;
    if (!isArrayElement(inherited) || inherited.isEmpty) return;
    if (!isArrayElement(workflow.steps)) return;

    const inheritedParameters = [...inherited];
    // what an operation step may inherit — the input-shaped entries filtered
    // out once, ahead of the per-step loop
    const requestShaped = inheritedParameters.filter(
      (parameter) =>
        !isParameterElement(parameter) || ParameterIdentity.locationOf(parameter) !== undefined,
    );

    for (const step of workflow.steps) {
      if (!isStepElement(step)) continue;
      if (step.parameters !== undefined && !isArrayElement(step.parameters)) continue;

      // when nothing applicable remains AND the step declares no list of its
      // own, there is nothing to synthesize. A step with its own list is still
      // rebuilt, so its duplicates collapse the same way whichever kind of
      // step it is — not depending on what the workflow happened to contribute
      const applicable = isStringElement(step.workflowId) ? inheritedParameters : requestShaped;
      if (applicable.length === 0 && step.parameters === undefined) continue;

      const own = isArrayElement(step.parameters) ? [...step.parameters] : [];
      step.parameters = new StepParametersElement(
        uniqWith(ParameterIdentity.equal, [...own, ...applicable]),
      );
    }
  }
}

export default ArazzoWorkflowNormalizer;
