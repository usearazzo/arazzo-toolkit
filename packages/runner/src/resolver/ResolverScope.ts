/**
 * Identifies the step something is being resolved or located for, so a thrown
 * error can say which one it came from. Every resolver that only ever runs
 * within a step's scope — {@link OpenAPIOperationParameterResolver},
 * {@link WorkflowParameterResolver}, {@link RequestBodyResolver},
 * {@link ActionResolver} — takes this, as does
 * {@link OpenAPIOperationLocatorNormalizer} for the step whose operation it
 * locates.
 * @public
 */
export interface StepScope {
  /**
   * The workflow the step belongs to, when the caller knows it: step ids are
   * only unique within a workflow.
   */
  readonly workflowId?: string;
  readonly stepId: string;
}

/**
 * Identifies the step or workflow a resolver is resolving for. The wider
 * union {@link OutputResolver} takes, since it resolves both a step's
 * `outputs` and a workflow's — the one case with no step to name.
 * @public
 */
export type ResolverScope = StepScope | { readonly workflowId: string };
