import { toValue } from '@speclynx/apidom-core';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import type { ParameterElement, StepParametersElement } from '@speclynx/apidom-ns-arazzo-1';

/**
 * Resolves a runtime expression to its value.
 *
 * Bridged to a lenient runtime expression evaluator
 * (`(expression) => runtimeExpressionEvaluator.evaluate(expression)`), so an
 * unresolvable reference yields `undefined` rather than throwing.
 * @public
 */
export type ParameterValueResolver = (expression: string) => unknown;

/**
 * Resolves a step's `parameters` to a plain map of resolved values.
 *
 * What a parameter's `value` means is shared by every kind of step and lives
 * here; how the resolved values are *keyed* is the subclass's policy, one per
 * step target — {@link OpenAPIOperationParameterResolver} keys request
 * delivery for a step targeting an operation, {@link WorkflowParameterResolver}
 * keys a sub-workflow's inputs for a step targeting a `workflowId`. Each
 * executor constructs the one resolver its kind of step calls for.
 * @public
 */
abstract class StepParameterResolver {
  /**
   * Resolves each parameter's `value`, returning the map keyed by the
   * subclass's policy. Returns an empty object when there are no parameters.
   */
  abstract resolve(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
  ): Record<string, unknown>;

  /**
   * Resolves a parameter's `value`.
   *
   * Per Arazzo 1.0.1, a parameter `value` is either a literal or a whole
   * runtime expression — there is no embedded/interpolated expression. So a
   * `value` that is a string is resolved as an expression only when the entire
   * string is a valid runtime expression; every other value (a non-expression
   * string such as `"{$inputs.x}"`, a number, boolean, object, array, or null)
   * is a literal and is used as-is. This is deliberately not template
   * interpolation.
   */
  protected resolveValue(parameter: ParameterElement, resolve: ParameterValueResolver): unknown {
    const value = toValue(parameter.value);
    return typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
  }
}

export default StepParameterResolver;
