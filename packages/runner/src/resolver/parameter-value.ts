import { toValue } from '@speclynx/apidom-core';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import type { ParameterElement } from '@speclynx/apidom-ns-arazzo-1';

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
 * Resolves an Arazzo Parameter Object's `value` — the semantics shared by
 * every parameter resolver, whatever map it keys the result into.
 *
 * Per Arazzo 1.0.1, a parameter `value` is either a literal or a whole runtime
 * expression — there is no embedded/interpolated expression. So a `value` that
 * is a string is resolved as an expression only when the entire string is a
 * valid runtime expression; every other value (a non-expression string such as
 * `"{$inputs.x}"`, a number, boolean, object, array, or null) is a literal and
 * is used as-is. This is deliberately not template interpolation.
 * @internal
 */
export const resolveParameterValue = (
  parameter: ParameterElement,
  resolve: ParameterValueResolver,
): unknown => {
  const value = toValue(parameter.value);
  return typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
};

export default resolveParameterValue;
