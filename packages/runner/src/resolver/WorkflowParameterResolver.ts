import { toValue } from '@speclynx/apidom-core';
import { isParameterElement, type StepParametersElement } from '@speclynx/apidom-ns-arazzo-1';

import StepParameterResolver, { type ParameterValueResolver } from './StepParameterResolver.ts';

/**
 * Resolves the `parameters` of a step targeting a `workflowId` into the
 * sub-workflow's inputs.
 *
 * Values follow the literal-vs-expression semantics shared through
 * {@link StepParameterResolver}. Keys are bare parameter names: per the
 * specification, "when the step in context specifies a `workflowId`, then all
 * parameters map to workflow inputs" — which are keyed by name alone, even
 * for an inherited parameter that carries an `in`. Locations are not
 * consulted, so two parameters differing only in `in` collapse by name here,
 * which for inputs is the override mechanism, not a loss.
 *
 * The first parameter to claim a name wins: the list is ordered by
 * precedence, most specific first, as `ArazzoWorkflowNormalizer` leaves it
 * once a step's own parameters have been merged with the ones it inherits —
 * the override order the specification requires.
 * @public
 */
class WorkflowParameterResolver extends StepParameterResolver {
  /**
   * Resolves each parameter's `value`, returning a `name` → value map.
   * Returns an empty object when there are no parameters.
   */
  resolve(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (parameters === undefined) return result;

    for (const parameter of parameters) {
      if (!isParameterElement(parameter)) continue;

      const name = toValue(parameter.name) as string | undefined;
      if (typeof name !== 'string') continue;
      // first entry wins — see the precedence note above. `Object.hasOwn` rather
      // than `name in result`, so a parameter named `toString` is not mistaken
      // for one already resolved.
      if (Object.hasOwn(result, name)) continue;

      result[name] = this.resolveValue(parameter, resolve);
    }

    return result;
  }
}

export default WorkflowParameterResolver;
