import { isArrayElement } from '@speclynx/apidom-datamodel';
import {
  isSuccessActionElement,
  isFailureActionElement,
  isCriterionElement,
  type StepOnSuccessElement,
  type StepOnFailureElement,
  type SuccessActionElement,
  type FailureActionElement,
  type CriterionElement,
} from '@speclynx/apidom-ns-arazzo-1';

import ResolverError from '../errors/ResolverError.ts';
import type { StepScope } from '../resolver/ResolverScope.ts';

/**
 * Determines whether a single criterion is met.
 *
 * Bridged to a criterion evaluator
 * (`(criterion) => criterionEvaluator.evaluate(criterion, resolve)`); an
 * unresolvable/failing criterion is `false`, not an error.
 * @public
 */
export type CriterionPredicate = (criterion: CriterionElement) => boolean;

/**
 * The action selected for a step outcome — a Success or Failure Action element.
 * @public
 */
export type SelectedAction = SuccessActionElement | FailureActionElement;

/**
 * Which of a step's two action lists is being resolved.
 *
 * Named by the caller rather than read off the element: a well-formed list
 * carries its own type (`StepOnSuccessElement` / `StepOnFailureElement`), but a
 * malformed one is whatever the author wrote — and that is precisely the case
 * that needs the name.
 * @public
 */
export type StepActionsField = 'onSuccess' | 'onFailure';

/**
 * Selects the actions to take for a step outcome from its `onSuccess` /
 * `onFailure` list.
 *
 * Actions are tried in order and every one whose `criteria` all pass is
 * returned (an action with no criteria always matches). Action elements are
 * returned as-is — interpreting them (branching on `type`, reading
 * `stepId`/`workflowId`/`retryAfter`/`retryLimit`) is the caller's concern, and
 * keeping them elements preserves the document provenance. The usual caller
 * acts on the first and takes an empty result as "no action matched", applying
 * the path default — the next sequential step on success, break-and-return on
 * failure.
 *
 * A step's list is the only list there is: Reusable Object entries are already
 * inlined by workflow normalization, and the workflow-level
 * `successActions` / `failureActions` a step falls back to are inherited into
 * `onSuccess` / `onFailure` by the same pass, so a well-formed document reaches
 * this point as the step's own list of concrete action elements.
 * @public
 */
class ActionResolver {
  /**
   * Returns every action whose criteria are all met, in list order.
   *
   * The whole matching chain rather than only the first, because the caller
   * needs both: it acts on `[0]`, and the one honoring "retryLimit exhausted
   * prior to subsequent failure actions" walks the rest, falling from an
   * exhausted `retry` to the next matching action without re-evaluating
   * criteria. Empty when the list is absent or nothing matches.
   *
   * `field` names which of the step's two lists this is. The resolver is handed
   * the list, not the step, and the one case that needs the name — a list that
   * is present but not a list — is exactly the case where the element's own type
   * no longer distinguishes them. `scope` names the step itself, for the same
   * reason, in a thrown {@link ResolverError}.
   *
   * A well-formed list whose entry is not a Success/Failure Action Object
   * throws rather than being skipped: an unrecognized entry is indistinguishable
   * from a step that deliberately declared no action for it, and the `goto` /
   * `end` its author was reaching for would otherwise never happen without a
   * word said about why.
   */
  resolveAll(
    actions: StepOnSuccessElement | StepOnFailureElement | undefined,
    isCriterionMet: CriterionPredicate,
    field: StepActionsField,
    scope: StepScope,
  ): SelectedAction[] {
    if (actions === undefined) return [];
    // present but scalar: walking it would fail as a bare
    // `TypeError: actions is not iterable`.
    if (!isArrayElement(actions)) {
      throw new ResolverError(`\`${field}\` is present but is not a list`, {
        ...scope,
        target: field,
        reason: 'malformed-actions',
      });
    }

    const matched: SelectedAction[] = [];
    for (const action of actions) {
      if (!isSuccessActionElement(action) && !isFailureActionElement(action)) {
        throw new ResolverError(
          `\`${field}\` contains an entry that is not a Success/Failure Action Object`,
          { ...scope, target: field, reason: 'malformed-action-entry' },
        );
      }
      if (this.#criteriaMet(action, isCriterionMet, scope)) {
        matched.push(action);
      }
    }

    return matched;
  }

  /**
   * Whether every criterion of the action passes. An action with no criteria
   * matches vacuously.
   *
   * A `criteria` that is present but not a list, or that contains an entry
   * that is not a Criterion Object, throws either way: an entry the resolver
   * cannot read and a container it cannot read are both a document that does
   * not say what its author meant, the same as an unrecognized entry in the
   * action list itself.
   */
  #criteriaMet(
    action: SelectedAction,
    isCriterionMet: CriterionPredicate,
    scope: StepScope,
  ): boolean {
    const criteria = action.criteria;
    if (criteria === undefined) return true;
    if (!isArrayElement(criteria)) {
      throw new ResolverError("An action's `criteria` is present but is not a list", {
        ...scope,
        target: 'criteria',
        reason: 'malformed-criteria',
      });
    }

    for (const criterion of criteria) {
      if (!isCriterionElement(criterion)) {
        throw new ResolverError(
          "An action's `criteria` contains an entry that is not a Criterion Object",
          { ...scope, target: 'criteria', reason: 'malformed-criterion' },
        );
      }
      if (!isCriterionMet(criterion)) return false;
    }
    return true;
  }
}

export default ActionResolver;
