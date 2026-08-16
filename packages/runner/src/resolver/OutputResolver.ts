import { toValue } from '@speclynx/apidom-core';
import type { StepOutputsElement, WorkflowOutputsElement } from '@speclynx/apidom-ns-arazzo-1';

import ValueResolver, { type RuntimeExpressionResolver } from './ValueResolver.ts';

/**
 * Resolves a step's or workflow's `outputs` to a plain map of name → value.
 *
 * Values follow the family-wide literal-vs-expression rule of
 * {@link ValueResolver} (the spec types `outputs` as `Map[string,
 * {expression}]`, so a whole runtime expression is the authored norm and
 * anything else is a literal).
 *
 * The result is the map an executor stores into the workflow execution state so
 * later steps can read `$steps.{id}.outputs.{name}` / `$outputs.{name}`.
 * @public
 */
class OutputResolver extends ValueResolver {
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
