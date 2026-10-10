import { assocPath, hasPath } from 'ramda';
import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isObjectElement, isStringElement } from '@speclynx/apidom-datamodel';
import {
  compile as compileJSONPointer,
  parse as parseJSONPointer,
  testJSONPointer,
} from '@swaggerexpert/json-pointer';
import { interpolate, test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';
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
 * Marks a bare-expression payload value that did not resolve. Its container
 * decides what "not provided" means there: an object member is omitted, while
 * an array element or the whole payload throws.
 */
const UNRESOLVED = Symbol('unresolved');

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
 * The `payload` is resolved first. Per the specification it "can contain"
 * runtime expressions, so it is walked: every string in it — the payload
 * itself, or any value nested in its objects and arrays — that is a whole
 * runtime expression resolves to its typed value, and every other string has
 * its embedded `{expression}` occurrences interpolated (tolerantly, so literal
 * braces such as a JSON template's own are kept). Object keys and resolved
 * values are never evaluated.
 *
 * An unresolved expression reads as "not provided": an object member is
 * omitted, while a whole-expression payload, an array element or an embedded
 * expression — none of which can be omitted — throws {@link ResolverError}
 * (`unresolved-expression`), as does an invalid embedded expression
 * (`invalid-expression`).
 *
 * Then each `replacements` entry is applied — its `value` is resolved by the
 * family-wide literal-vs-expression rule of {@link ArazzoValueResolver} and set
 * into the payload at the replacement's `target` JSON Pointer. A replacement
 * whose value does not resolve is skipped, leaving the payload as authored.
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

    const authoredPayload = toValue(requestBody.payload);
    let payload = this.#requireResolved(
      authoredPayload,
      this.#resolvePayloadValue(authoredPayload, [], resolve, scope),
      [],
      scope,
    );

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
        const value = this.resolveValue(replacement.value, resolve);
        if (value === undefined) continue;
        payload = this.#applyReplacement(payload, target, value, scope);
      }
    }

    const contentType = isStringElement(requestBody.contentType)
      ? (toValue(requestBody.contentType) as string)
      : undefined;

    return contentType === undefined ? { payload } : { payload, contentType };
  }

  /**
   * Resolves one authored payload value at the `tokens` path, recursing into
   * objects and arrays. Returns {@link UNRESOLVED} for a bare expression that
   * did not resolve, for its container to handle.
   */
  #resolvePayloadValue(
    value: unknown,
    tokens: readonly string[],
    resolve: RuntimeExpressionResolver,
    scope: StepScope,
  ): unknown {
    if (typeof value === 'string') return this.#resolvePayloadString(value, tokens, resolve, scope);

    if (Array.isArray(value)) {
      return value.map((item: unknown, index) => {
        const itemTokens = [...tokens, String(index)];
        const resolved = this.#resolvePayloadValue(item, itemTokens, resolve, scope);
        return this.#requireResolved(item, resolved, itemTokens, scope);
      });
    }

    if (value !== null && typeof value === 'object') {
      // `fromEntries` defines own properties, so an authored `__proto__` key
      // stays a plain member instead of replacing the prototype.
      return Object.fromEntries(
        Object.entries(value)
          .map(([key, member]) => [
            key,
            this.#resolvePayloadValue(member, [...tokens, key], resolve, scope),
          ])
          .filter(([, resolved]) => resolved !== UNRESOLVED),
      );
    }

    return value;
  }

  /**
   * Resolves one authored payload string: a whole runtime expression to its
   * typed value (or {@link UNRESOLVED}), anything else by tolerant
   * interpolation of its embedded `{expression}` occurrences.
   */
  #resolvePayloadString(
    value: string,
    tokens: readonly string[],
    resolve: RuntimeExpressionResolver,
    scope: StepScope,
  ): unknown {
    if (isRuntimeExpression(value)) {
      const resolved = resolve(value);
      return resolved === undefined ? UNRESOLVED : resolved;
    }

    return interpolate(
      value,
      (expression) => {
        const resolved = resolve(expression);
        if (resolved === undefined) throw this.#unresolvedError(expression, tokens, scope);
        return resolved;
      },
      {
        strict: false,
        onError: ({ text }) => {
          throw new ResolverError(
            `Invalid runtime expression "${text}" in ${this.#payloadTarget(tokens)}`,
            { ...scope, target: this.#payloadTarget(tokens), reason: 'invalid-expression' },
          );
        },
      },
    );
  }

  /**
   * Throws for an unresolved bare expression where omission is not possible —
   * the whole payload or an array element; passes every other value through.
   */
  #requireResolved(
    authored: unknown,
    resolved: unknown,
    tokens: readonly string[],
    scope: StepScope,
  ): unknown {
    if (resolved === UNRESOLVED) throw this.#unresolvedError(authored as string, tokens, scope);
    return resolved;
  }

  #unresolvedError(expression: string, tokens: readonly string[], scope: StepScope): ResolverError {
    const target = this.#payloadTarget(tokens);
    return new ResolverError(`Runtime expression "${expression}" in ${target} did not resolve`, {
      ...scope,
      target,
      reason: 'unresolved-expression',
    });
  }

  /**
   * Names a payload location for errors: `requestBody.payload` itself, or a
   * member as a JSON Pointer fragment (e.g. `requestBody.payload#/order/petId`).
   */
  #payloadTarget(tokens: readonly string[]): string {
    return tokens.length === 0
      ? 'requestBody.payload'
      : `requestBody.payload#${compileJSONPointer(tokens)}`;
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
