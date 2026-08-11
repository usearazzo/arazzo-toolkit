import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import type { StepElement } from '@speclynx/apidom-ns-arazzo-1';

import type { SelectedAction } from '../action/ActionResolver.ts';
import ExecutionError from '../errors/ExecutionError.ts';

/**
 * What a workflow does after a step, once the step's action has been
 * interpreted.
 *
 * `next` runs the following step (the success default, or a matched `goto` that
 * targets the next step); `goto` jumps to a step by id within the current
 * workflow; `end` stops the run with `status: ended`; `break` stops with
 * `status: failed` (the failure default).
 * @internal
 */
export type Transition =
  | { readonly kind: 'next' }
  | { readonly kind: 'goto'; readonly stepId: string }
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
 * - **`goto` a `workflowId`** — a transfer of control to another workflow, whose
 *   one-way-versus-return semantics are ambiguous in 1.0.1, so it is rejected
 *   rather than guessed at. This is where that support lands once the semantics
 *   are settled: most likely as another `Transition` kind, leaving the running of
 *   the target to the executor, since running workflows is orchestration rather
 *   than policy.
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
      if (isStringElement(action.workflowId)) {
        throw new ExecutionError(
          `action on step "${stepId}" in workflow "${workflowId}" gotos a workflowId; not supported yet`,
          { stepId, workflowId, reason: 'goto-workflow-unsupported' },
        );
      }
      if (isStringElement(action.stepId)) {
        return { kind: 'goto', stepId: toValue(action.stepId) as string };
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
   * The index of a `goto` target within the workflow's steps; a target that names
   * no step in this workflow is an authoring error.
   */
  indexOfStep(steps: readonly StepElement[], stepId: string, workflowId: string): number {
    const index = steps.findIndex((step) => (toValue(step.stepId) as string) === stepId);
    if (index === -1) {
      throw new ExecutionError(
        `goto target step "${stepId}" not found in workflow "${workflowId}"`,
        { stepId, workflowId, reason: 'goto-target-not-found' },
      );
    }
    return index;
  }
}

export default StepTransitionInterpreter;
