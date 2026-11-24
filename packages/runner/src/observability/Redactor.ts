import { isPlainObject } from 'ramda-adjunct';
import { isElement } from '@speclynx/apidom-datamodel';
import { parse as parseExpression } from '@swaggerexpert/arazzo-runtime-expression';
import { unescape as unescapeToken } from '@swaggerexpert/json-pointer';
import { parse as parseMediaType } from '@swaggerexpert/media-types';

import type { ArazzoRunnerEvent } from './ArazzoRunnerEvent.ts';

/**
 * The parts of a parsed runtime expression that name what it reads.
 */
interface ExpressionNode {
  readonly name?: string;
  readonly outputName?: string;
  readonly fieldName?: string;
  readonly componentName?: string;
  readonly jsonPointer?: { readonly referenceTokens: readonly { readonly value: string }[] };
  readonly source?: {
    readonly reference?: {
      readonly token?: string;
      readonly name?: string;
      readonly jsonPointer?: { readonly referenceTokens: readonly { readonly value: string }[] };
    };
  };
}

/**
 * A parsed media type, lowercased by the parser.
 */
interface MediaType {
  readonly type: string;
  readonly subtype: string;
  readonly suffix?: string;
}

/**
 * Options for the Redactor.
 * @public
 */
export interface RedactorOptions {
  /**
   * Wildcard patterns of the names whose values are masked. `*` matches any
   * run of characters; matching is case-insensitive and against the whole
   * name, so `*token*` matches `access_token` and `X-Auth-Token`. The list
   * replaces {@link Redactor.defaultFields}; spread it to extend it.
   */
  readonly fields?: readonly string[];
}

/**
 * Masks credentials in events before they leave the process.
 *
 * Events carry what the run saw, credentials included, like the request a
 * request interceptor receives. Pass every event through
 * {@link Redactor.event} before logging, exporting or writing it.
 *
 * It masks by name, whatever the event:
 *
 * - the value of any field whose name matches a pattern: headers, query
 *   parameters, body and output fields, at any depth;
 * - a criterion value whose runtime expression reads a matching name, in its
 *   base or in any token of its JSON Pointer (`$inputs.password`,
 *   `$steps.login.outputs.token#/value`);
 * - in every absolute URL, as `URL` parses it, the userinfo and the matching
 *   query and fragment parameters;
 * - a request or response body that is JSON or a URL-encoded form, field by
 *   field, and any other body, or any object that is not plain data, whole.
 *
 * A settled event's `error` is carried as it is, the error `execute` rejects
 * with. A credential under a name no pattern matches is carried as it is. The
 * masked value is `REDACTED`.
 * @public
 */
class Redactor {
  static readonly CENSOR = 'REDACTED';

  /**
   * Elastic APM's `sanitizeFieldNames` defaults, with `*secret*` for its exact
   * `secret` (which misses OAuth's `client_secret`), plus the signed-URL query
   * parameters OpenTelemetry's HTTP conventions mask.
   */
  static readonly defaultFields: readonly string[] = Object.freeze([
    'password',
    'passwd',
    'pwd',
    '*secret*',
    '*key',
    '*token*',
    '*session*',
    '*credit*',
    '*card*',
    '*auth*',
    'set-cookie',
    '*principal*',
    'pw',
    'pass',
    'connect.sid',
    'cookie',
    'AWSAccessKeyId',
    'Signature',
    'sig',
    'X-Goog-Signature',
  ]);

  readonly #patterns: readonly RegExp[];
  readonly #matches = new Map<string, boolean>();

  constructor(options: RedactorOptions = {}) {
    this.#patterns = (options.fields ?? Redactor.defaultFields).map(Redactor.#compile);
  }

  /**
   * A masked copy of the event.
   */
  event<E extends ArazzoRunnerEvent>(event: E): E {
    return this.#walk(event, new WeakSet()) as E;
  }

  #walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return URL.canParse(value) ? this.#url(value) : value;
    if (typeof value !== 'object' || value === null) return value;
    // an ApiDOM element (a selected action) is the document's own, a date
    // holds no credential, and an error is the one `execute` rejects with,
    // unmasked; any other object that is not plain data cannot be walked
    // field by field.
    if (isElement(value) || value instanceof Date || value instanceof Error) return value;
    if (!Array.isArray(value) && !isPlainObject(value)) return Redactor.CENSOR;
    // only the objects on the current path: a shared, acyclic one is walked
    // again where it reappears, a cycle is cut.
    if (seen.has(value)) return Redactor.CENSOR;
    seen.add(value);
    try {
      return Array.isArray(value)
        ? value.map((item) => this.#walk(item, seen))
        : this.#fields(value as Record<string, unknown>, seen);
    } finally {
      seen.delete(value);
    }
  }

  #fields(object: Record<string, unknown>, seen: WeakSet<object>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(object)) {
      let masked: unknown;
      if (this.#masks(name)) masked = Redactor.CENSOR;
      else if (name === 'body' && isPlainObject(object.headers)) {
        masked = this.#body(item, object.headers as Record<string, string>, seen);
      } else masked = this.#walk(item, seen);
      // defined, not assigned, so an own `__proto__` key stays data
      Object.defineProperty(redacted, name, {
        value: masked,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return redacted;
  }

  /**
   * Whether a name matches a pattern. A runtime expression matches when any
   * name it reads does.
   */
  #masks(name: string): boolean {
    let matches = this.#matches.get(name);
    if (matches === undefined) {
      const names = name.startsWith('$') ? Redactor.#namesRead(name) : [name];
      matches = names.some((candidate) =>
        this.#patterns.some((pattern) => pattern.test(candidate)),
      );
      this.#matches.set(name, matches);
    }
    return matches;
  }

  /**
   * The absolute URL with its userinfo and matching query and fragment
   * parameters masked. A URL with nothing to mask comes back exactly as it
   * was, not normalized.
   */
  #url(value: string): string {
    const url = new URL(value);
    let masked = false;
    if (url.username !== '' || url.password !== '') {
      url.username = Redactor.CENSOR;
      url.password = Redactor.CENSOR;
      masked = true;
    }
    const query = this.#params(url.search.slice(1));
    if (query !== undefined) {
      url.search = query;
      masked = true;
    }
    const fragment = this.#params(url.hash.slice(1));
    if (fragment !== undefined) {
      url.hash = fragment;
      masked = true;
    }
    return masked ? url.href : value;
  }

  /**
   * A body masked by what its `Content-Type` says it is.
   */
  #body(body: unknown, headers: Readonly<Record<string, string>>, seen: WeakSet<object>): unknown {
    if (typeof body !== 'string' || body === '') return this.#walk(body, seen);

    const mediaType = Redactor.#contentType(headers);
    if (mediaType?.subtype === 'json' || mediaType?.suffix === 'json') {
      try {
        return JSON.stringify(this.#walk(JSON.parse(body), seen));
      } catch {
        return Redactor.CENSOR;
      }
    }
    if (mediaType?.type === 'application' && mediaType.subtype === 'x-www-form-urlencoded') {
      return this.#params(body) ?? body;
    }
    return Redactor.CENSOR;
  }

  /**
   * URL-encoded `name=value` pairs with matching values masked, or
   * `undefined` when none matches, so the caller keeps the text as it was.
   */
  #params(text: string): string | undefined {
    let masked = false;
    const params = [...new URLSearchParams(text)].map(([name, value]) => {
      if (!this.#masks(name)) return [name, value];
      masked = true;
      return [name, Redactor.CENSOR];
    });
    return masked ? new URLSearchParams(params).toString() : undefined;
  }

  static #contentType(headers: Readonly<Record<string, string>>): MediaType | undefined {
    const name = Object.keys(headers).find((key) => key.toLowerCase() === 'content-type');
    if (name === undefined) return undefined;
    try {
      return parseMediaType(headers[name], { type: 'media-type' }).tree as MediaType | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Every name a runtime expression reads: the header, query, path, input,
   * output or component name, and each token of its JSON Pointer, e.g.
   * `token` and `value` for `$steps.login.outputs.token#/value`. A string
   * that does not parse as an expression is its own name.
   */
  static #namesRead(expression: string): string[] {
    let tree: ExpressionNode | undefined;
    try {
      tree = parseExpression(expression).tree as ExpressionNode | undefined;
    } catch {
      return [expression];
    }
    if (tree === undefined) return [expression];

    const reference = tree.source?.reference;
    const tokens = (tree.jsonPointer ?? reference?.jsonPointer)?.referenceTokens ?? [];
    const names = [
      reference?.token,
      reference?.name,
      tree.name,
      tree.outputName,
      tree.fieldName,
      tree.componentName,
      ...tokens.map((token) => unescapeToken(token.value)),
    ];
    return names.filter((name): name is string => name !== undefined);
  }

  static #compile(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }
}

export default Redactor;
