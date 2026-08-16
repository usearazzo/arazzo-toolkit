import type { StepParametersElement } from '@speclynx/apidom-ns-arazzo-1';

import ArazzoValueResolver, { type RuntimeExpressionResolver } from './ArazzoValueResolver.ts';

/**
 * Resolves a step's `parameters` to a plain map of resolved values.
 *
 * What a parameter's `value` means is the family-wide rule of
 * {@link ArazzoValueResolver}; how the resolved values are *keyed* is the subclass's
 * policy, one per step target — {@link OpenAPIOperationParameterResolver} keys
 * request delivery for a step targeting an operation,
 * {@link WorkflowParameterResolver} keys a sub-workflow's inputs for a step
 * targeting a `workflowId`. Each executor constructs the one resolver its kind
 * of step calls for.
 * @public
 */
abstract class StepParameterResolver extends ArazzoValueResolver {
  /**
   * Resolves each parameter's `value`, returning the map keyed by the
   * subclass's policy. Returns an empty object when there are no parameters.
   */
  abstract resolve(
    parameters: StepParametersElement | undefined,
    resolve: RuntimeExpressionResolver,
  ): Record<string, unknown>;
}

export default StepParameterResolver;
