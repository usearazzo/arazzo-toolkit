import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import type { ParameterElement } from '@speclynx/apidom-ns-arazzo-1';

/**
 * The location (`in`) of an Arazzo Parameter Object, read three-way:
 *
 * - a string — the declared location, e.g. `'query'`;
 * - `undefined` — no location is declared: the shape of a workflow-input
 *   mapping, meaningful for a step targeting a `workflowId` (where "all
 *   parameters map to workflow inputs") but naming no place in a request;
 * - `null` — a location is declared but is not a string (`in: 1`), which
 *   names no location and is identical to no other, its own duplicate
 *   included.
 *
 * This is the one reading of a parameter's side of the `(name, in)` identity,
 * shared by `ArazzoWorkflowNormalizer` (which merges a workflow's parameters
 * into its steps by that identity) and `ParameterResolver` (which keys
 * delivery by it) — so the two cannot drift apart.
 * @internal
 */
export const parameterLocation = (parameter: ParameterElement): string | undefined | null => {
  const location = parameter.in;
  if (location === undefined) return undefined;
  return isStringElement(location) ? (toValue(location) as string) : null;
};

export default parameterLocation;
