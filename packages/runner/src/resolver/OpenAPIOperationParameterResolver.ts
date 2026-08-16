import { isParameterElement, type StepParametersElement } from '@speclynx/apidom-ns-arazzo-1';

import ParameterDelivery from '../client/ParameterDelivery.ts';
import ParameterIdentity from '../document/ParameterIdentity.ts';
import ResolverError from '../errors/ResolverError.ts';
import StepParameterResolver from './StepParameterResolver.ts';
import type { RuntimeExpressionResolver } from './ArazzoValueResolver.ts';

/**
 * Resolves the `parameters` of a step targeting an OpenAPI operation into the
 * map the operation is executed with.
 *
 * Values follow the family-wide literal-vs-expression rule of
 * {@link ArazzoValueResolver}. Keys and their first-wins claiming are
 * {@link ParameterDelivery}'s: `'{in}.{name}'` for a location the client
 * can address — a parameter is unique by `(name, in)`, so keying by name
 * alone would collapse two parameters that differ only in their location into
 * one entry and silently drop the other, where an operation legally declaring
 * `token` both as a header and as a query parameter must receive both — and
 * the bare name for Arazzo's `querystring`, which names no OpenAPI location.
 * First-wins is the override order the specification requires: the list is
 * ordered by precedence, most specific first, as `ArazzoWorkflowNormalizer`
 * leaves it once a step's own parameters have been merged with the ones it
 * inherits.
 *
 * What the map reports, this resolver judges. A parameter without a location
 * throws {@link ResolverError}: a step targeting an operation requires one
 * (the normalizer does not inherit input-shaped workflow parameters into such
 * steps, so this is the step's own authoring error), and delivering it bare
 * instead would let it capture *every* declared location of that name — see
 * {@link ParameterDelivery} for the lookup order that makes it so. A
 * non-string location throws for the same reason it deduplicates with nothing
 * in the normalizer: it names no location. And two *different* parameters the
 * map reports as colliding cannot both be delivered, so a collision throws
 * rather than silently dropping one — whether they collide on one key (the
 * scheme is not injective: a `querystring` parameter named `header.token` and
 * a header parameter named `token` both produce `header.token`) or across a
 * bare/qualified pair sharing a name (a `querystring` `token` next to a
 * header `token`), where the client would consult the bare name first and
 * silently capture the qualified value.
 * @public
 */
class OpenAPIOperationParameterResolver extends StepParameterResolver {
  /**
   * Resolves each parameter's `value`, returning a
   * {@link ParameterDelivery}-keyed record. Returns an empty object when
   * there are no parameters.
   */
  resolve(
    parameters: StepParametersElement | undefined,
    resolve: RuntimeExpressionResolver,
  ): Record<string, unknown> {
    const delivery = new ParameterDelivery();
    if (parameters === undefined) return delivery.toRecord();

    for (const parameter of parameters) {
      if (!isParameterElement(parameter)) continue;
      // a Parameter Object without an identity has a missing or non-string
      // name — reported as loudly as a malformed location below, rather than
      // silently dropped from the request
      const identity = ParameterIdentity.of(parameter);
      if (identity === undefined) {
        throw new ResolverError('Parameter has a missing or non-string name', {
          reason: 'missing-name',
        });
      }

      const { name, location } = identity;
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

      const { key, outcome } = delivery.claim(location, name);
      // the same parameter declared again: the earlier, more specific one won
      if (outcome === 'duplicate') continue;
      if (outcome === 'collision') {
        throw new ResolverError(
          `Parameter "${name}" (in: ${location}) collides with another parameter on the ` +
            `delivery key "${key}" and cannot be delivered unambiguously`,
          { target: name, reason: 'ambiguous-delivery' },
        );
      }

      delivery.set(key, this.resolveValue(parameter.value, resolve));
    }

    return delivery.toRecord();
  }
}

export default OpenAPIOperationParameterResolver;
