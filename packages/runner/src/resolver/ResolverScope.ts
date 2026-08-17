/**
 * Identifies the step a resolver is resolving for, so a thrown
 * {@link ResolverError} can say which one it came from. Every resolver that
 * only ever runs within a step's scope — {@link OpenAPIOperationParameterResolver},
 * {@link WorkflowParameterResolver}, {@link RequestBodyResolver},
 * {@link ActionResolver} — takes this.
 * @public
 */
export interface StepScope {
  readonly stepId: string;
}

/**
 * Identifies the step or workflow a resolver is resolving for. The wider
 * union {@link OutputResolver} takes, since it resolves both a step's
 * `outputs` and a workflow's — the one case with no step to name.
 * @public
 */
export type ResolverScope = StepScope | { readonly workflowId: string };
