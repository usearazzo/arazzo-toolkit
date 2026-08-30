import { type JSONPointer } from '@speclynx/apidom-json-pointer';

import type { WorkflowId } from './ArazzoWorkflowIndex.ts';

/**
 * Unique identifier of a step within an Arazzo workflow.
 * @public
 */
export type StepId = string;

/**
 * Index mapping workflowId → stepId → JSON Pointer to the step in an Arazzo
 * document. Steps are unique only within their workflow, hence the nesting.
 * @public
 */
class ArazzoStepIndex extends Map<WorkflowId, Map<StepId, JSONPointer>> {
  /**
   * The JSON Pointer of a step, or `undefined` when the workflow or step is absent.
   */
  getStep(workflowId: WorkflowId, stepId: StepId): JSONPointer | undefined {
    return this.get(workflowId)?.get(stepId);
  }
}

export default ArazzoStepIndex;
