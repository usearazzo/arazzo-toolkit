import { toValue } from '@speclynx/apidom-core';
import type { StepOutputsElement, WorkflowOutputsElement } from '@speclynx/apidom-ns-arazzo-1';

import ArazzoValueResolver, { type RuntimeExpressionResolver } from './ArazzoValueResolver.ts';

/**
 * Resolves a step's or workflow's `outputs` to a plain map of name → value.
 *
 * Values are resolved by the family-wide rule of {@link ArazzoValueResolver},
 * with one reading peculiar to outputs: the spec types `outputs` as
 * `Map[string, {expression}]`, so a whole runtime expression is the *only*
 * authored form — unlike a parameter's `value` or a `requestBody` payload
 * (typed `Any`), a literal is not a form the spec provides for here. The
 * shared rule's pass-through branch therefore tolerates an invalid document
 * by carrying the non-expression value as-is, rather than sanctioning it.
 *
 * The result is the map an executor stores into the workflow execution state so
 * later steps can read `$steps.{id}.outputs.{name}` / `$outputs.{name}`.
 * @public
 */
class OutputResolver extends ArazzoValueResolver {
  /**
   * Resolves each output value, returning a `name` → value map. Returns an empty
   * object when there are no outputs.
   */
  resolve(
    outputs: StepOutputsElement | WorkflowOutputsElement | undefined,
    resolve: RuntimeExpressionResolver,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (outputs === undefined) return result;

    outputs.forEach((value, key) => {
      const name = toValue(key) as string;
      // defined rather than assigned: bracket assignment under a name like
      // `__proto__` would mutate the record's prototype instead of creating an
      // own property, silently losing the output
      Object.defineProperty(result, name, {
        value: this.resolveValue(value, resolve),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    });

    return result;
  }
}

export default OutputResolver;
