import { toValue } from '@speclynx/apidom-core';
import { isStringElement, type Element } from '@speclynx/apidom-datamodel';
import { isParameterElement, type ParameterElement } from '@speclynx/apidom-ns-arazzo-1';

/**
 * The `(name, in)` identity of an Arazzo Parameter Object — the one encoding
 * of what makes two parameters "the same parameter", shared by
 * `ArazzoWorkflowNormalizer` (which merges a workflow's parameters into its
 * steps by it) and `OpenAPIOperationParameterResolver` (which keys delivery by
 * it), so the two cannot drift apart.
 *
 * Identity is the pair — the rule ApiDOM's OpenAPI `normalize-parameters`
 * plugin applies when inheriting a Path Item's parameters into an Operation
 * ("a unique parameter is defined by a combination of a name and location").
 * Arazzo's `in` is optional where OpenAPI's is required, and an absent one
 * compares equal only to another absent one: that is a step naming a
 * `workflowId`, where "all parameters map to workflow inputs" and there is no
 * location to pair the name with. Names are case-sensitive per the
 * specification, so nothing is case-folded.
 *
 * The location side is read three-way:
 *
 * - a string — the declared location, e.g. `'query'`;
 * - `undefined` — no location is declared: the shape of a workflow-input
 *   mapping, meaningful for a step targeting a `workflowId` but naming no
 *   place in a request;
 * - `null` — a location is declared but is not a string (`in: 1`), which
 *   names no location and equals no other, its own duplicate included.
 *
 * An element without a well-formed identity has none at all
 * ({@link ParameterIdentity.of} yields `undefined`) and is equal to nothing —
 * an unresolved Reusable Object, a scalar someone put in the list, or a
 * parameter whose `name` is missing or not a string. Such an entry has
 * nothing to deduplicate on, and the normalizer's merge rebuilds the step's
 * list, so calling it equal to another would delete authored content from the
 * document. The OpenAPI plugin guards the same way and for the same reason.
 * @internal
 */
class ParameterIdentity {
  /**
   * The identity of an element, or `undefined` when it has none — the element
   * is not a Parameter Object, or its `name` is not a string.
   */
  static of(element: Element): ParameterIdentity | undefined {
    if (!isParameterElement(element)) return undefined;
    const name = toValue(element.name);
    if (typeof name !== 'string') return undefined;
    return new ParameterIdentity(name, ParameterIdentity.locationOf(element));
  }

  /**
   * Whether two elements are the same parameter: both have an identity, and
   * the identities are equal. The shape `uniqWith` consumes.
   */
  static equal(element1: Element, element2: Element): boolean {
    const identity1 = ParameterIdentity.of(element1);
    const identity2 = ParameterIdentity.of(element2);
    return identity1 !== undefined && identity2 !== undefined && identity1.equals(identity2);
  }

  /**
   * The three-way location read alone, for callers that need it without a
   * full identity — the inheritance filter must keep a nameless-but-located
   * entry, which has a location but no identity.
   */
  static locationOf(parameter: ParameterElement): string | undefined | null {
    const location = parameter.in;
    if (location === undefined) return undefined;
    return isStringElement(location) ? (toValue(location) as string) : null;
  }

  readonly name: string;

  readonly location: string | undefined | null;

  private constructor(name: string, location: string | undefined | null) {
    this.name = name;
    this.location = location;
  }

  /**
   * Whether this and the other identity name the same parameter. A malformed
   * location equals nothing, its own duplicate included.
   */
  equals(other: ParameterIdentity): boolean {
    return (
      this.location !== null &&
      other.location !== null &&
      this.name === other.name &&
      this.location === other.location
    );
  }
}

export default ParameterIdentity;
