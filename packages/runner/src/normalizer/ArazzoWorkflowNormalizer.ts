import { uniqWith } from 'ramda';
import {
  isParameterElement,
  isStepElement,
  StepParametersElement,
  StepOnSuccessElement,
  StepOnFailureElement,
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
 * producing a self-contained workflow element, then inherits the workflow's
 * "applicable for all steps" defaults — its `parameters`, and its
 * `successActions` / `failureActions` — into each of its steps.
 *
 * All passes mutate, and what they mutate is the document itself: the extractor
 * hands over the live workflow node out of `document.parseResult`, and
 * dereferencing runs `immutable: false`, returning that same instance. Writing
 * through to the document is what lets the registry act as a natural cache —
 * a workflow reached a second time is already dereferenced and already
 * inherited into, so no pass repeats. The inheritance is idempotent for
 * exactly that reason.
 *
 * The writes differ in kind, which is worth knowing before sharing a
 * registry. Dereferencing only *resolves* what the document already says — a
 * `$ref` replaced by its target means the same thing. Inheritance *synthesizes*:
 * afterwards a step carries `parameters` or an `onSuccess` its source never
 * declared, so a consumer that reads the document back (`APIDocument.toJSON()`)
 * sees one that no longer matches the file it was parsed from. The OpenAPI
 * normalizers write inherited servers, parameters and security requirements into
 * their documents the same way, so this is the layer's established contract
 * rather than a property of Arazzo.
 * @public
 */
class ArazzoWorkflowNormalizer {
  readonly #options: ApiDOMReferenceOptions;

  constructor(options: ArazzoWorkflowNormalizerOptions = {}) {
    this.#options = mergeOptions(normalizerOptionsOverride as ApiDOMReferenceOptions, options);
  }

  /**
   * Dereferences the workflow subtree against its parent document, then inherits
   * the workflow's `parameters` and default actions into its steps.
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

    // normalization (mutable) — after dereferencing, so a `parameters` or
    // action list reaching the steps through a $components reference is
    // inherited as a resolved Parameter / Success Action Object rather than as
    // the Reusable Object it was written as.
    this.#inheritParametersToSteps(dereferenced);
    this.#inheritActionsToSteps(dereferenced);

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

  /**
   * Inherits the workflow's `successActions` / `failureActions` into each step
   * that declares no `onSuccess` / `onFailure` of its own.
   *
   * Per Arazzo 1.0.1 both lists are "applicable for all steps described under
   * this workflow", and a step's own list **overrides** the corresponding
   * workflow one — wholesale, with no per-action merge, which is where this
   * differs from the parameters above. Success and failure fall back
   * independently: a step may override only its `onFailure` and still inherit
   * the workflow's `successActions`.
   *
   * Presence is tested with `hasKey`, not truthiness: a step declaring an empty
   * list (`onSuccess: []`) has *overridden* the default with an empty set of
   * actions, not asked for one — it is skipped, as is a step whose `onSuccess`
   * is present but not a list, for the same reason the parameters pass leaves a
   * malformed list alone. Testing the key is also what makes the pass
   * idempotent: after the first run the step has it, so a workflow reached again
   * through the registry cache is skipped.
   *
   * Unlike parameters there is no step-kind filter — an action names a
   * transition within the workflow, which is as meaningful for a step targeting
   * a `workflowId` as for one invoking an operation, so both kinds take the
   * defaults.
   *
   * The workflow's own action *elements* are shared into the steps rather than
   * copied, matching what falling back to one shared list did before: retry
   * budgets are keyed by action element identity ({@link StepRetryRunner}) and
   * held per `run()` call, so steps sharing an inherited `retry` share nothing
   * that outlives the attempt loop.
   */
  #inheritActionsToSteps(workflow: WorkflowElement): void {
    if (!isArrayElement(workflow.steps)) return;

    const { successActions, failureActions } = workflow;
    // an empty list defaults to nothing, which is what declaring no list
    // already means — synthesizing one would only move the document further
    // from its source for no change in behavior.
    const inheritSuccess = isArrayElement(successActions) && !successActions.isEmpty;
    const inheritFailure = isArrayElement(failureActions) && !failureActions.isEmpty;
    if (!inheritSuccess && !inheritFailure) return;

    for (const step of workflow.steps) {
      if (!isStepElement(step)) continue;

      if (inheritSuccess && !step.hasKey('onSuccess')) {
        step.onSuccess = new StepOnSuccessElement([...successActions]);
      }
      if (inheritFailure && !step.hasKey('onFailure')) {
        step.onFailure = new StepOnFailureElement([...failureActions]);
      }
    }
  }
}

export default ArazzoWorkflowNormalizer;
