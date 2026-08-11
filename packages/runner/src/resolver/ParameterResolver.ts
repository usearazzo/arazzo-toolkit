import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import {
  isParameterElement,
  type ParameterElement,
  type StepParametersElement,
} from '@speclynx/apidom-ns-arazzo-1';

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
 * Derives the map key a parameter's resolved value is stored under.
 */
type ParameterKey = (parameter: ParameterElement, name: string) => string;

/**
 * Resolves a step's `parameters` to a plain map of resolved values.
 *
 * Per Arazzo 1.0.1, a parameter `value` is either a literal or a whole runtime
 * expression — there is no embedded/interpolated expression. So a `value` that
 * is a string is resolved as an expression only when the entire string is a
 * valid runtime expression; every other value (a non-expression string such as
 * `"{$inputs.x}"`, a number, boolean, object, array, or null) is a literal and
 * is used as-is. This is deliberately not template interpolation.
 *
 * Two key shapes are produced, one per consumer:
 *
 * - {@link ParameterResolver.resolve} keys by bare `name`. This is the shape of
 *   a sub-workflow's inputs: per the specification, "when the step in context
 *   specifies a `workflowId`, then all parameters map to workflow inputs" —
 *   which are keyed by name alone, even for an inherited parameter that carries
 *   an `in`.
 * - {@link ParameterResolver.resolveQualified} keys by `'{in}.{name}'`, the
 *   form the OpenAPI client accepts alongside bare names. A parameter is unique
 *   by `(name, in)`, so keying by name alone would collapse two parameters that
 *   differ only in their location into one entry and silently drop the other —
 *   an operation legally declaring `token` both as a header and as a query
 *   parameter could never receive both.
 *
 * Within either map, the first parameter to claim a key wins: the list is
 * ordered by precedence, most specific first, as `ArazzoWorkflowNormalizer`
 * leaves it once a step's own parameters have been merged with the ones it
 * inherits from its workflow. A step must be able to override an inherited
 * parameter — the specification says it "will override it but can never remove
 * it" — and reading the list in the other direction would let the parameter it
 * inherited win instead. Under the qualified keys the collision is exactly the
 * `(name, in)` identity the normalizer deduplicates on, so only a genuinely
 * same parameter can shadow another.
 * @public
 */
class ParameterResolver {
  /**
   * Resolves each parameter's `value`, returning a `name` → value map — the
   * shape of a sub-workflow's inputs. Returns an empty object when there are
   * no parameters.
   */
  resolve(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
  ): Record<string, unknown> {
    return this.#resolve(parameters, resolve, (_parameter, name) => name);
  }

  /**
   * Resolves each parameter's `value`, returning a map keyed by
   * `'{in}.{name}'` — the shape `buildRequest` accepts, letting parameters
   * that differ only in their location coexist. A parameter without a
   * well-formed location (no `in`, or a non-string one) keeps its bare name,
   * which the client resolves the same way.
   */
  resolveQualified(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
  ): Record<string, unknown> {
    return this.#resolve(parameters, resolve, (parameter, name) => {
      const location = parameter.in;
      return isStringElement(location) ? `${toValue(location)}.${name}` : name;
    });
  }

  #resolve(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
    keyFor: ParameterKey,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (parameters === undefined) return result;

    for (const parameter of parameters) {
      if (!isParameterElement(parameter)) continue;

      const name = toValue(parameter.name) as string | undefined;
      if (typeof name !== 'string') continue;

      const key = keyFor(parameter, name);
      // first entry wins — see the precedence note above. `Object.hasOwn` rather
      // than `key in result`, so a parameter named `toString` is not mistaken
      // for one already resolved.
      if (Object.hasOwn(result, key)) continue;

      const value = toValue(parameter.value);
      result[key] =
        typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
    }

    return result;
  }
}

export default ParameterResolver;
