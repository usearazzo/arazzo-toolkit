import { assocPath, hasPath } from 'ramda';
import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isObjectElement, isStringElement } from '@speclynx/apidom-datamodel';
import { parse as parseJSONPointer, testJSONPointer } from '@swaggerexpert/json-pointer';
import { isPayloadReplacementElement, type RequestBodyElement } from '@speclynx/apidom-ns-arazzo-1';

import ResolverError from '../errors/ResolverError.ts';
import ArazzoValueResolver, { type RuntimeExpressionResolver } from './ArazzoValueResolver.ts';
import type { StepScope } from './ResolverScope.ts';

/**
 * Matches a canonical non-negative integer (RFC 6901 array index): no leading
 * zeros other than `0` itself.
 */
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/**
 * A resolved request body: the payload with all replacements applied, plus the
 * declared content type when present.
 * @public
 */
export interface ResolvedRequestBody {
  readonly payload: unknown;
  readonly contentType?: string;
}

/**
 * Resolves a step's `requestBody` to a concrete payload.
 *
 * The `payload` is resolved first, by the family-wide literal-vs-expression
 * rule of {@link ArazzoValueResolver}. Then each `replacements` entry is applied —
 * its `value` is resolved by the same rule and set into the payload at the
 * replacement's `target` JSON Pointer.
 *
 * `target` may be a JSON Pointer or an XPath per the specification; only JSON
 * Pointer targets are supported — an XPath target throws {@link ResolverError}.
 * @public
 */
class RequestBodyResolver extends ArazzoValueResolver {
  /**
   * Resolves the request body, returning its payload and content type. Returns
   * `undefined` when there is no request body.
   *
   * `scope` names the step in a thrown {@link ResolverError}.
   */
  resolve(
    requestBody: RequestBodyElement | undefined,
    resolve: RuntimeExpressionResolver,
    scope: StepScope,
  ): ResolvedRequestBody | undefined {
    if (requestBody === undefined) return undefined;

    // present but scalar: `.payload`, `.replacements` and `.contentType` are
    // all plain `undefined` on a non-map element, so the step would silently
    // send no body and report success.
    if (!isObjectElement(requestBody)) {
      throw new ResolverError('`requestBody` is present but is not a map', {
        ...scope,
        target: 'requestBody',
        reason: 'malformed-request-body',
      });
    }

    let payload = this.resolveValue(requestBody.payload, resolve);

    if (requestBody.replacements !== undefined) {
      // present but scalar: walking it would fail as a bare
      // `TypeError: requestBody.replacements is not iterable`.
      if (!isArrayElement(requestBody.replacements)) {
        throw new ResolverError('`requestBody.replacements` is present but is not a list', {
          ...scope,
          target: 'requestBody.replacements',
          reason: 'malformed-replacements',
        });
      }
      for (const replacement of requestBody.replacements) {
        if (!isPayloadReplacementElement(replacement)) continue;
        const target = toValue(replacement.target) as string | undefined;
        if (typeof target !== 'string') continue;
        payload = this.#applyReplacement(
          payload,
          target,
          this.resolveValue(replacement.value, resolve),
          scope,
        );
      }
    }

    const contentType = isStringElement(requestBody.contentType)
      ? (toValue(requestBody.contentType) as string)
      : undefined;

    return contentType === undefined ? { payload } : { payload, contentType };
  }

  /**
   * Immutably sets `value` into `payload` at the `target` JSON Pointer,
   * returning a new payload (the input is never mutated, so a payload aliased
   * from a runtime expression's resolved value — e.g. `$inputs.order` — is not
   * corrupted). Throws {@link ResolverError} for a non-JSON-Pointer target
   * (e.g. XPath) or a target that does not resolve within the payload.
   */
  #applyReplacement(payload: unknown, target: string, value: unknown, scope: StepScope): unknown {
    if (!testJSONPointer(target)) {
      throw new ResolverError(
        `Unsupported requestBody replacement target "${target}" (expected JSON Pointer)`,
        {
          ...scope,
          target,
          reason: 'unsupported-target',
        },
      );
    }

    // an empty pointer targets the payload root — replace the whole payload.
    const tokens = this.#pathTokens(target);
    if (tokens.length === 0) return value;

    // the target must resolve against the payload; `hasPath` also rejects
    // prototype-chain tokens (e.g. `__proto__`) since they are not own paths.
    if (!hasPath(tokens, payload as object)) {
      throw new ResolverError(
        `requestBody replacement target "${target}" does not resolve in the payload`,
        {
          ...scope,
          target,
          reason: 'unresolved-target',
        },
      );
    }

    return assocPath(tokens, value, payload as object);
  }

  /**
   * Parses a JSON Pointer into path tokens, coercing an array-index token to a
   * number so it indexes an array rather than converting it to an object key
   * (Ramda's `assocPath` distinguishes numeric from string keys).
   */
  #pathTokens(target: string): (string | number)[] {
    return (parseJSONPointer(target).tree as string[]).map((token) =>
      ARRAY_INDEX.test(token) ? Number(token) : token,
    );
  }
}

export default RequestBodyResolver;
