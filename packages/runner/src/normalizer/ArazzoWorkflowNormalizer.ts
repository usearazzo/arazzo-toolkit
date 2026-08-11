import { uniqWith } from 'ramda';
import {
  isParameterElement,
  isStepElement,
  StepParametersElement,
  type ParameterElement,
  type WorkflowElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isStringElement, type Element } from '@speclynx/apidom-datamodel';
import { dereferenceArazzoElement, defaultDereferenceArazzoOptions } from '@usearazzo/resolver';
import {
  mergeOptions,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import type { PartialDeep } from 'type-fest';

import type ArazzoDocument from '../document/ArazzoDocument.ts';
import { parameterLocation } from '../document/parameter-location.ts';
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
 * Whether two Parameter Objects name the same location, read through the
 * shared {@link parameterLocation} primitive.
 *
 * Absent on both sides is a match — that is the `workflowId` step case, where
 * parameters are workflow inputs with no location to pair the name with. A
 * malformed location (`in: 1`) reads as `null` and equals nothing, its own
 * duplicate included: it is not a location, so two parameters carrying one are
 * no more "the same parameter" than two unnamed entries are, and deduplicating
 * them would drop authored content the same way.
 */
const locationEquals = (parameter1: ParameterElement, parameter2: ParameterElement): boolean => {
  const location1 = parameterLocation(parameter1);
  const location2 = parameterLocation(parameter2);
  return location1 !== null && location2 !== null && location1 === location2;
};

/**
 * Whether two Arazzo Parameter Objects are the same parameter.
 *
 * Identity is the `(name, in)` pair — the rule ApiDOM's OpenAPI
 * `normalize-parameters` plugin applies when inheriting a Path Item's parameters
 * into an Operation ("a unique parameter is defined by a combination of a name
 * and location"). Arazzo's `in` is optional where OpenAPI's is required, and an
 * absent one compares equal only to another absent one: that is a step naming a
 * `workflowId`, where "all parameters map to workflow inputs" and there is no
 * location to pair the name with. Names are case-sensitive per the
 * specification, so nothing is case-folded.
 *
 * Anything without a well-formed identity is equal to nothing, including itself
 * — an unresolved Reusable Object, a scalar someone put in the list, a parameter
 * with no `name`, or one whose `name` or `in` is not a string. Such an entry has
 * nothing to deduplicate on, and since this feeds a `uniqWith` that rebuilds the
 * step's list, calling it equal to another would delete authored content from
 * the document. The OpenAPI plugin guards the same way and for the same reason.
 */
const parameterEquals = (parameter1: Element, parameter2: Element): boolean =>
  isParameterElement(parameter1) &&
  isParameterElement(parameter2) &&
  isStringElement(parameter1.name) &&
  isStringElement(parameter2.name) &&
  toValue(parameter1.name) === toValue(parameter2.name) &&
  locationEquals(parameter1, parameter2);

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
   * declaration winning wherever the two name the same {@link parameterEquals}
   * parameter. `uniqWith` keeps the first of each equal pair, so the step's own
   * list leads, exactly as `inheritParametersToOperation` orders an Operation's
   * ahead of the Path Item's it inherits.
   *
   * That leading position is what makes the override effective and not merely
   * present: {@link ParameterResolver} keys resolved values first-wins — by the
   * same `(name, in)` identity for an operation step, and by bare name for a
   * `workflowId` step's inputs — so wherever the two collapse to one key, the
   * earlier survives, which must be the step's.
   *
   * Inheriting the elements here rather than the resolved values is what lets a
   * workflow-level `value` that is a runtime expression still be evaluated once
   * per step, against the state that step is entered with.
   *
   * Not every workflow parameter is applicable to every kind of step. One
   * without a location (`in`) is a workflow-input mapping — meaningful for a
   * step targeting a `workflowId`, where "all parameters map to workflow
   * inputs", but naming no place in a request — so it is inherited only into
   * such steps. Inheriting it into an operation step would plant a bare-named
   * value in the request-parameter map, and the client consults bare names
   * before location-qualified ones, so it would silently outrank the step's own
   * same-named parameters. The workflow's own `parameters` list is left intact;
   * only the synthesized per-step copies are filtered.
   *
   * A malformed `steps` or `parameters` is left for the executor to report as
   * the authoring error it is; there is nothing to inherit through it here, and
   * a step whose own `parameters` is present but not a list is skipped rather
   * than handed a synthesized one — overwriting it would erase the very thing
   * that makes the document invalid and leave nothing to report. An entry
   * *within* either list that is not a Parameter Object is carried across
   * untouched rather than filtered out, for the same reason: rebuilding a step's
   * list is no licence to drop what its author wrote, and `ParameterResolver`
   * ignores it anyway. A parameter whose location is malformed (`in: 1`) is
   * likewise carried, for the resolver to report loudly.
   */
  #inheritParametersToSteps(workflow: WorkflowElement): void {
    const inherited = workflow.parameters;
    if (!isArrayElement(inherited) || inherited.isEmpty) return;
    if (!isArrayElement(workflow.steps)) return;

    const inheritedParameters = [...inherited];

    for (const step of workflow.steps) {
      if (!isStepElement(step)) continue;
      if (step.parameters !== undefined && !isArrayElement(step.parameters)) continue;

      const applicable = isStringElement(step.workflowId)
        ? inheritedParameters
        : inheritedParameters.filter(
            (parameter) =>
              !isParameterElement(parameter) || parameterLocation(parameter) !== undefined,
          );
      if (applicable.length === 0) continue;

      const own = isArrayElement(step.parameters) ? [...step.parameters] : [];
      step.parameters = new StepParametersElement(
        uniqWith(parameterEquals, [...own, ...applicable]),
      );
    }
  }
}

export default ArazzoWorkflowNormalizer;
