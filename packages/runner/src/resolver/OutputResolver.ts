import { toValue } from '@speclynx/apidom-core';
import { isObjectElement } from '@speclynx/apidom-datamodel';
import type { StepOutputsElement, WorkflowOutputsElement } from '@speclynx/apidom-ns-arazzo-1';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';

import ResolverError from '../errors/ResolverError.ts';
import ArazzoValueResolver, { type RuntimeExpressionResolver } from './ArazzoValueResolver.ts';
import type { ResolverScope } from './ResolverScope.ts';

/**
 * Resolves a step's or workflow's `outputs` to a plain map of name → value.
 *
 * The spec types `outputs` as `Map[string, {expression}]`, so a whole runtime
 * expression is the *only* authored form — unlike a parameter's `value` or a
 * `requestBody` payload (typed `Any`), where {@link ArazzoValueResolver} lets a
 * literal through. An output that is not a valid runtime expression is an
 * authoring error and throws a {@link ResolverError}.
 *
 * The result is the map an executor stores into the workflow execution state so
 * later steps can read `$steps.{id}.outputs.{name}` / `$outputs.{name}`.
 * @public
 */
class OutputResolver extends ArazzoValueResolver {
  /**
   * Resolves each output value, returning a `name` → value map. Returns an empty
   * object when there are no outputs.
   *
   * `scope` names the step or workflow the outputs belong to, for a thrown
   * {@link ResolverError}. An output value that is not a valid runtime
   * expression throws with `reason: 'invalid-expression'`.
   */
  resolve(
    outputs: StepOutputsElement | WorkflowOutputsElement | undefined,
    resolve: RuntimeExpressionResolver,
    scope: ResolverScope,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (outputs === undefined) return result;
    // present but not a map: the walk below would fail as a bare
    // `TypeError: outputs.forEach is not a function`.
    if (!isObjectElement(outputs)) {
      throw new ResolverError('`outputs` is present but is not a map', {
        ...scope,
        target: 'outputs',
        reason: 'malformed-outputs',
      });
    }

    outputs.forEach((value, key) => {
      const name = toValue(key) as string;
      const expression = toValue(value);
      if (typeof expression !== 'string' || !isRuntimeExpression(expression)) {
        throw new ResolverError(`Output "${name}" is not a valid runtime expression`, {
          ...scope,
          target: 'outputs',
          reason: 'invalid-expression',
        });
      }
      // defined rather than assigned: a name like `__proto__` hits the
      // Object.prototype accessor on bracket assignment, so no own property is
      // ever created and the output is silently lost — and an object value
      // additionally rewrites the record's prototype
      Object.defineProperty(result, name, {
        value: resolve(expression),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });

    return result;
  }
}

export default OutputResolver;
