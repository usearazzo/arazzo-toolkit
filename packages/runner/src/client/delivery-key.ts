/**
 * The key a parameter value travels to `buildRequest` under — the single
 * encoding of the vendored swagger-client's parameter-addressing scheme.
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
 * Diff this against the vendored bundle's lookup when bumping swagger-client.
 * @internal
 */
export const deliveryKey = (location: string, name: string): string =>
  location === 'querystring' ? name : `${location}.${name}`;

export default deliveryKey;
