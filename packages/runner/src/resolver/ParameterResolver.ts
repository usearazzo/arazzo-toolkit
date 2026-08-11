import { toValue } from '@speclynx/apidom-core';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
import {
  isParameterElement,
  type ParameterElement,
  type StepParametersElement,
} from '@speclynx/apidom-ns-arazzo-1';

import { deliveryKey } from '../client/delivery-key.ts';
import { parameterLocation } from '../document/parameter-location.ts';
import ResolverError from '../errors/ResolverError.ts';

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
 * Per Arazzo 1.0.1, a parameter `value` is either a literal or a whole runtime
 * expression — there is no embedded/interpolated expression. So a `value` that
 * is a string is resolved as an expression only when the entire string is a
 * valid runtime expression; every other value (a non-expression string such as
 * `"{$inputs.x}"`, a number, boolean, object, array, or null) is a literal and
 * is used as-is. This is deliberately not template interpolation.
 *
 * Two key shapes are produced, one per kind of step:
 *
 * - {@link ParameterResolver.resolveWorkflowInputs} keys by bare `name`. This
 *   is the shape of a sub-workflow's inputs: per the specification, "when the
 *   step in context specifies a `workflowId`, then all parameters map to
 *   workflow inputs" — which are keyed by name alone, even for an inherited
 *   parameter that carries an `in`.
 * - {@link ParameterResolver.resolveRequestParameters} keys by
 *   `'{in}.{name}'`, the form the OpenAPI client accepts alongside bare names.
 *   A parameter is unique by `(name, in)`, so keying by name alone would
 *   collapse two parameters that differ only in their location into one entry
 *   and silently drop the other — an operation legally declaring `token` both
 *   as a header and as a query parameter could never receive both.
 *
 * Within either map, the first parameter to claim a key wins: the list is
 * ordered by precedence, most specific first, as `ArazzoWorkflowNormalizer`
 * leaves it once a step's own parameters have been merged with the ones it
 * inherits from its workflow. A step must be able to override an inherited
 * parameter — the specification says it "will override it but can never remove
 * it" — and reading the list in the other direction would let the parameter it
 * inherited win instead.
 * @public
 */
class ParameterResolver {
  /**
   * Resolves each parameter's `value`, returning a `name` → value map — the
   * shape of a sub-workflow's inputs. Returns an empty object when there are
   * no parameters. Locations are not consulted: two parameters differing only
   * in `in` collapse by name here, which for inputs is the override mechanism,
   * not a loss.
   */
  resolveWorkflowInputs(
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

      result[name] = this.#resolveValue(parameter, resolve);
    }

    return result;
  }

  /**
   * Resolves each parameter's `value`, returning the map an OpenAPI operation
   * is executed with, keyed per {@link deliveryKey}: `'{in}.{name}'` for a
   * location the client can address — so parameters that differ only in their
   * location coexist — and the bare name for Arazzo's `querystring`, which
   * names no OpenAPI location and can still reach a same-named declared
   * parameter that way.
   *
   * A parameter without a location throws {@link ResolverError}: a step
   * targeting an operation requires one (the normalizer does not inherit
   * input-shaped workflow parameters into such steps, so this is the step's
   * own authoring error), and delivering it bare instead would let it capture
   * *every* declared location of that name — see {@link deliveryKey} for the
   * lookup order that makes it so. A non-string location throws for the same
   * reason it deduplicates with nothing in the normalizer: it names no
   * location.
   *
   * The key scheme is not injective — a parameter legally named
   * `header.token` in the `querystring` location and a header parameter named
   * `token` both produce the key `header.token`. Two *different* parameters
   * colliding on one key cannot both be delivered, so that throws
   * {@link ResolverError} rather than silently dropping one; the same
   * parameter declared twice collapses to its first, most specific
   * declaration as everywhere else.
   */
  resolveRequestParameters(
    parameters: StepParametersElement | undefined,
    resolve: ParameterValueResolver,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (parameters === undefined) return result;

    // which location claimed each key. Given a key, the claimant's name is
    // determined by its location (the key embeds the name, or is the name), so
    // location alone tells a genuine duplicate apart from a key collision.
    const claimedBy = new Map<string, string>();

    for (const parameter of parameters) {
      if (!isParameterElement(parameter)) continue;

      const name = toValue(parameter.name) as string | undefined;
      if (typeof name !== 'string') continue;

      const location = parameterLocation(parameter);
      if (location === undefined) {
        throw new ResolverError(
          `Parameter "${name}" declares no location ("in"), which a step targeting an operation requires`,
          { target: name, reason: 'missing-location' },
        );
      }
      if (location === null) {
        throw new ResolverError(`Parameter "${name}" has a non-string location ("in")`, {
          target: name,
          reason: 'malformed-location',
        });
      }

      const key = deliveryKey(location, name);
      if (Object.hasOwn(result, key)) {
        // the same parameter declared again: the earlier, more specific one won
        if (claimedBy.get(key) === location) continue;
        throw new ResolverError(
          `Parameter "${name}" (in: ${location}) collides with another parameter on the ` +
            `delivery key "${key}" and cannot be delivered unambiguously`,
          { target: name, reason: 'ambiguous-delivery' },
        );
      }
      claimedBy.set(key, location);

      result[key] = this.#resolveValue(parameter, resolve);
    }

    return result;
  }

  #resolveValue(parameter: ParameterElement, resolve: ParameterValueResolver): unknown {
    const value = toValue(parameter.value);
    return typeof value === 'string' && isRuntimeExpression(value) ? resolve(value) : value;
  }
}

export default ParameterResolver;
