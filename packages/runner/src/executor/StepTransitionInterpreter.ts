import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import type { StepElement } from '@speclynx/apidom-ns-arazzo-1';

import type { SelectedAction } from '../action/ActionResolver.ts';
import ExecutionError from '../errors/ExecutionError.ts';

/**
 * Which of an action's mutually exclusive `stepId` / `workflowId` fields are
 * present, ahead of a caller deciding what that means.
 *
 * Shared rather than duplicated by `goto`'s own check here and a `retry`
 * action's reference check in `WorkflowExecutor` — both Success/Failure
 * Action Object fields carry the identical "mutually exclusive" constraint,
 * so both need the identical two `isStringElement` reads before diverging on
 * their own wording and branch handling.
 * @internal
 */
export function actionTargets(action: {
  readonly stepId?: unknown;
  readonly workflowId?: unknown;
}): { readonly hasStepId: boolean; readonly hasWorkflowId: boolean } {
  return {
    hasStepId: isStringElement(action.stepId),
    hasWorkflowId: isStringElement(action.workflowId),
  };
}

/**
 * What a workflow does after a step, once the step's action has been
 * interpreted.
 *
 * `next` runs the following step (the success default, or a matched `goto` that
 * targets the next step); `goto` jumps to a step by id within the current
 * workflow; `transfer` hands control one-way to another workflow, which the
 * caller's run then ends on; `end` stops the run with `status: ended`; `break`
 * stops with `status: failed` (the failure default).
 * @internal
 */
export type Transition =
  | { readonly kind: 'next' }
  | { readonly kind: 'goto'; readonly stepId: string }
  | { readonly kind: 'transfer'; readonly workflowId: string }
  | { readonly kind: 'end' }
  | { readonly kind: 'break' };

/**
 * Which step's outcome is being interpreted — carried for diagnostics only.
 * @internal
 */
export interface StepTransitionContext {
  readonly workflowId: string;
  readonly stepId: string;
}

/**
 * Turns the action a step resolved to into what the workflow does next.
 *
 * This is the Arazzo 1.0.1 Success/Failure Action Object semantics in one place,
 * and nothing else: it holds no state, performs no I/O, and does not act on the
 * transition it returns — moving through the step list stays the workflow
 * executor's business.
 *
 * - **no matching action** — the path default: "the next sequential step shall be
 *   executed" on success, "break and return" on failure.
 * - **`end`** — "the workflow ends, and context returns to the caller with
 *   applicable outputs".
 * - **`goto` a `stepId`** — jumps within the current workflow, which is where the
 *   specification requires the target to be.
 * - **`goto` a `workflowId`** — a one-way transfer of control to another
 *   workflow: the `stepId`/`workflowId` field descriptions condition "context
 *   transfers back upon completion" on `retry` specifically, so for `goto` it
 *   does not — the current run ends here, and running the target is the
 *   executor's job, since running workflows is orchestration rather than
 *   policy. A `goto` naming both `stepId` and `workflowId` is malformed — the
 *   spec marks them mutually exclusive — and is rejected before either is
 *   read.
 * - **anything else** — malformed input rather than a defined control flow.
 *   `retry` is the one action that never arrives here: it is settled by
 *   {@link StepRetryRunner}, which yields only the terminal action a retry chain
 *   resolves to.
 * @internal
 */
class StepTransitionInterpreter {
  /**
   * Interprets a step's terminal action into the workflow's next transition.
   */
  interpret(
    action: SelectedAction | undefined,
    successful: boolean,
    context: StepTransitionContext,
  ): Transition {
    if (action === undefined) {
      // path default: next step on success, break-and-return on failure.
      return successful ? { kind: 'next' } : { kind: 'break' };
    }

    const { workflowId, stepId } = context;
    const type = toValue(action.type) as string;
    if (type === 'end') {
      return { kind: 'end' };
    }
    if (type === 'goto') {
      const { hasStepId, hasWorkflowId } = actionTargets(action);
      if (hasStepId && hasWorkflowId) {
        throw new ExecutionError(
          `goto action on step "${stepId}" in workflow "${workflowId}" declares both a stepId and a workflowId (mutually exclusive)`,
          { stepId, workflowId, reason: 'ambiguous-target' },
        );
      }
      if (hasStepId) {
        return { kind: 'goto', stepId: toValue(action.stepId) as string };
      }
      if (hasWorkflowId) {
        return { kind: 'transfer', workflowId: toValue(action.workflowId) as string };
      }
      throw new ExecutionError(
        `goto action on step "${stepId}" in workflow "${workflowId}" has neither stepId nor workflowId`,
        { stepId, workflowId, reason: 'goto-target-missing' },
      );
    }

    throw new ExecutionError(
      `action on step "${stepId}" in workflow "${workflowId}" has unsupported type "${type}"`,
      { stepId, workflowId, reason: 'unknown-action-type' },
    );
  }

  /**
   * The index of a step within the workflow's steps, by `stepId`; a target that
   * names no step in this workflow is an authoring error.
   *
   * A general lookup against the workflow's step list, shared rather than
   * duplicated by its two callers — a `goto` target and a `retry` action's
   * `stepId` reference — which report a miss the same way except for the
   * `reason` and wording that name which one it was. `descriptor` is
   * mandatory, not defaulted to the `goto` wording: an optional default would
   * let a future third caller silently inherit goto's diagnostics by
   * forgetting to pass one.
   */
  indexOfStep(
    steps: readonly StepElement[],
    stepId: string,
    workflowId: string,
    descriptor: { readonly reason: string; readonly label: string },
  ): number {
    const index = steps.findIndex((step) => (toValue(step.stepId) as string) === stepId);
    if (index === -1) {
      throw new ExecutionError(
        `${descriptor.label} step "${stepId}" not found in workflow "${workflowId}"`,
        { stepId, workflowId, reason: descriptor.reason },
      );
    }
    return index;
  }
}

export default StepTransitionInterpreter;
