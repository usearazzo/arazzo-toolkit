/**
 * The outcome of claiming a delivery key: `claimed` for a first claim,
 * `duplicate` when the same `(name, in)` parameter claims its key again, and
 * `collision` when a *different* parameter produces an already-claimed key.
 * @internal
 */
export type ParameterClaimOutcome = 'claimed' | 'duplicate' | 'collision';

/**
 * A parameter claim: the delivery key the `(location, name)` pair encodes to,
 * and how the claim resolved against the map's earlier entries.
 * @internal
 */
export interface ParameterClaim {
  readonly key: string;
  readonly outcome: ParameterClaimOutcome;
}

/**
 * The parameters map an OpenAPI operation is executed with — the single owner
 * of the vendored swagger-client's parameter-addressing scheme.
 *
 * The client accepts two key shapes in its `parameters` map and, for each
 * parameter the operation declares, consults the bare `name` *before* the
 * qualified `'{in}.{name}'` key (deminified from the vendored bundle:
 * `r = m[e.name]; if (r === undefined) r = m[`${e.in}.${e.name}`]`). Two
 * consequences shape everything that feeds the map:
 *
 * - qualified keys are what let parameters differing only in their location
 *   coexist — the client builds the same key from the declared parameter and
 *   matches it verbatim, never splitting it, so dots in a name are safe;
 * - a bare key silently outranks the qualified keys of every declared
 *   parameter bearing that name, so nothing may emit one for a location the
 *   client can address.
 *
 * Arazzo's `querystring` is the one location the client cannot address — it
 * names no OpenAPI location — so it keeps the bare name, which can still
 * reach a same-named declared parameter. Every other location is qualified,
 * including an unrecognized one: an unmatched qualified key is inert, where a
 * bare one would capture.
 *
 * Keys are claimed first-wins. The scheme is not injective, so the map also
 * discriminates a genuine duplicate from a collision of two different
 * parameters on one key: given a key, the claimant's name is determined by
 * its location (the key embeds the name, or is the name), so the location
 * alone identifies the claimant. What to do about a collision is the
 * caller's policy — the map only reports it.
 *
 * Diff this against the vendored bundle's lookup when bumping swagger-client.
 * @internal
 */
class ParameterDeliveryMap {
  /**
   * The key a `(location, name)` pair is delivered under — `'{in}.{name}'`,
   * or the bare name for `querystring`. See the class doc for why.
   */
  static keyFor(location: string, name: string): string {
    return location === 'querystring' ? name : `${location}.${name}`;
  }

  readonly #values: Record<string, unknown> = {};
  readonly #claimedBy = new Map<string, string>();

  /**
   * Claims the delivery key for a `(location, name)` pair, first-wins.
   * Only a `claimed` outcome entitles the caller to {@link ParameterDeliveryMap.set}
   * the key; a `duplicate` means the same parameter already holds it, and a
   * `collision` means a different parameter does.
   */
  claim(location: string, name: string): ParameterClaim {
    const key = ParameterDeliveryMap.keyFor(location, name);
    const claimant = this.#claimedBy.get(key);
    if (claimant === undefined) {
      this.#claimedBy.set(key, location);
      return { key, outcome: 'claimed' };
    }
    return { key, outcome: claimant === location ? 'duplicate' : 'collision' };
  }

  set(key: string, value: unknown): void {
    this.#values[key] = value;
  }

  /**
   * The accumulated record, in the shape `buildRequest` consumes.
   */
  toRecord(): Record<string, unknown> {
    return this.#values;
  }
}

export default ParameterDeliveryMap;
