import { toValue } from '@speclynx/apidom-core';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import { isParameterElement, type StepParametersElement } from '@speclynx/apidom-ns-arazzo-1';

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
 * Resolves a step's `parameters` to a plain map of name → value.
 *
 * Per Arazzo 1.0.1, a parameter `value` is either a literal or a whole runtime
 * expression — there is no embedded/interpolated expression. So a `value` that
 * is a string is resolved as an expression only when the entire string is a
 * valid runtime expression; every other value (a non-expression string such as
 * `"{$inputs.x}"`, a number, boolean, object, array, or null) is a literal and
 * is used as-is. This is deliberately not template interpolation.
 *
 * Values are keyed by parameter `name`; the parameter `in` (its location) is not
 * consulted here — how a resolved value is delivered to the client, and the
 * operation-vs-workflow distinction, are the executor's concern. Because `in` is
 * dropped, two parameters that differ only in it collapse into one entry, and
 * **the earlier of the two wins**: the list is ordered by precedence, most
 * specific first, as `ArazzoWorkflowNormalizer` leaves it once a step's own
 * parameters have been merged with the ones it inherits from its workflow. A
 * step must be able to override an inherited parameter — the specification says
 * it "will override it but can never remove it" — and reading the list in the
 * other direction would let the parameter it inherited win instead.
 * @public
 */
class ParameterResolver {
  /**
   * Resolves each parameter's `value`, returning a `name` → value map. Returns an
   * empty object when there are no parameters.
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

      const value = toValue(parameter.value);
      result[name] =
        typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
    }

    return result;
  }
}

export default ParameterResolver;
