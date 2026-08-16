import { toValue } from '@speclynx/apidom-core';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';

/**
 * Resolves a runtime expression to its value.
 *
 * Bridged to a lenient runtime expression evaluator
 * (`(expression) => runtimeExpressionEvaluator.evaluate(expression)`), so an
 * unresolvable reference yields `undefined` rather than throwing.
 * @public
 */
export type RuntimeExpressionResolver = (expression: string) => unknown;

/**
 * Base of every resolver of authored Arazzo values — the single home of the
 * literal-vs-expression rule they all share.
 *
 * Per Arazzo 1.0.1, an authored value (a parameter's `value`, an `outputs`
 * entry, a `requestBody` payload or replacement value) is either a literal or
 * a whole runtime expression — there is no embedded/interpolated expression.
 * So a value that is a string is resolved as an expression only when the
 * entire string is a valid runtime expression; every other value (a
 * non-expression string such as `"{$inputs.x}"`, a number, boolean, object,
 * array, or null) is a literal and is used as-is. This is deliberately not
 * template interpolation.
 * @public
 */
abstract class ValueResolver {
  /**
   * Resolves one authored value element by the rule above.
   */
  protected resolveValue(element: unknown, resolve: RuntimeExpressionResolver): unknown {
    const value = toValue(element);
    return typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
  }
}

export default ValueResolver;
