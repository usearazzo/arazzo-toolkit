import { isPlainObject } from 'ramda-adjunct';
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
 * It masks by name, whatever the event: the value of any field whose name
 * matches a pattern (headers, query parameters, body and output fields, at
 * any depth), and a criterion value whose runtime expression reads a
 * matching name (`$inputs.password`, `$response.body#/access_token`). Every
 * URL has its userinfo masked and its matching query values. A request or
 * response body that is JSON or a URL-encoded form is masked field by field
 * and cut to {@link Redactor.BODY_LIMIT} characters; any other body is
 * masked whole. A credential under a name no pattern matches is carried as
 * it is. The masked value is `REDACTED`.
 * @public
 */
class Redactor {
  static readonly CENSOR = 'REDACTED';

  static readonly BODY_LIMIT = 10_000;

  /**
   * Elastic APM's `sanitizeFieldNames` defaults, plus `*secret*` (Elastic's
   * exact `secret` misses OAuth's `client_secret`) and the signed-URL query
   * parameters OpenTelemetry's HTTP conventions mask.
   */
  static readonly defaultFields: readonly string[] = Object.freeze([
    'password',
    'passwd',
    'pwd',
    'secret',
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

  constructor(options: RedactorOptions = {}) {
    this.#patterns = (options.fields ?? Redactor.defaultFields).map(Redactor.#compile);
  }

  /**
   * A masked copy of the event.
   */
  event<E extends ArazzoRunnerEvent>(event: E): E {
    return this.#walk(event) as E;
  }

  #walk(value: unknown): unknown {
    if (typeof value === 'string')
      return /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value) ? this.#url(value) : value;
    if (Array.isArray(value)) return value.map((item) => this.#walk(item));
    if (!isPlainObject(value)) return value;

    const object = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(object)) {
      let masked: unknown;
      if (this.#masks(name)) masked = Redactor.CENSOR;
      else if (name === 'body' && isPlainObject(object.headers)) {
        masked = this.#body(item, object.headers as Record<string, string>);
      } else masked = this.#walk(item);
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
   * Whether a name matches a pattern. A runtime expression is matched by the
   * last name it reads.
   */
  #masks(name: string): boolean {
    const target = name.startsWith('$') ? Redactor.#lastName(name) : name;
    return target !== undefined && this.#patterns.some((pattern) => pattern.test(target));
  }

  /**
   * The URL with its userinfo and matching query values masked, worked on as
   * a string so the rest keeps the encoding it was sent with.
   */
  #url(url: string): string {
    // up to the last `@` before the path, as URL parsers split userinfo
    const withoutUserinfo = url.replace(
      /^((?:[a-z][a-z\d+.-]*:)?\/\/)[^/?#]*@/i,
      `$1${Redactor.CENSOR}:${Redactor.CENSOR}@`,
    );
    const queryStart = withoutUserinfo.indexOf('?');
    if (queryStart === -1) return withoutUserinfo;
    const fragmentStart = withoutUserinfo.indexOf('#', queryStart);
    const queryEnd = fragmentStart === -1 ? withoutUserinfo.length : fragmentStart;
    const query = this.#form(withoutUserinfo.slice(queryStart + 1, queryEnd));
    return `${withoutUserinfo.slice(0, queryStart + 1)}${query}${withoutUserinfo.slice(queryEnd)}`;
  }

  /**
   * A body masked by what its `Content-Type` says it is, and cut to the limit.
   */
  #body(body: unknown, headers: Readonly<Record<string, string>>): unknown {
    let masked: unknown;
    if (body === undefined || body === null || body === '') masked = body;
    else if (typeof body !== 'string')
      masked = isPlainObject(body) || Array.isArray(body) ? this.#walk(body) : Redactor.CENSOR;
    else {
      const mediaType = Redactor.#contentType(headers);
      if (mediaType?.subtype === 'json' || mediaType?.suffix === 'json') {
        try {
          masked = JSON.stringify(this.#walk(JSON.parse(body)));
        } catch {
          masked = Redactor.CENSOR;
        }
      } else if (
        mediaType?.type === 'application' &&
        mediaType.subtype === 'x-www-form-urlencoded'
      ) {
        masked = this.#form(body);
      } else masked = Redactor.CENSOR;
    }

    const text = typeof masked === 'string' ? masked : JSON.stringify(masked);
    return text !== undefined && text.length > Redactor.BODY_LIMIT
      ? `${text.slice(0, Redactor.BODY_LIMIT)}…`
      : masked;
  }

  /**
   * `name=value` pairs joined by `&`, with matching values masked.
   */
  #form(pairs: string): string {
    return pairs
      .split('&')
      .map((pair) => {
        const separator = pair.indexOf('=');
        if (separator === -1) return pair;
        const name = pair.slice(0, separator);
        return this.#masks(Redactor.#decode(name)) ? `${name}=${Redactor.CENSOR}` : pair;
      })
      .join('&');
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
   * The last name a runtime expression reads: its JSON Pointer's last token,
   * else the header, query, path, input, output or component name; none for
   * `$statusCode` and the like, or an expression that does not parse.
   */
  static #lastName(expression: string): string | undefined {
    let tree: ExpressionNode | undefined;
    try {
      tree = parseExpression(expression).tree as ExpressionNode | undefined;
    } catch {
      return undefined;
    }
    const reference = tree?.source?.reference;
    const token = (tree?.jsonPointer ?? reference?.jsonPointer)?.referenceTokens.at(-1)?.value;
    if (token !== undefined) return unescapeToken(token);
    return (
      reference?.token ??
      reference?.name ??
      tree?.name ??
      tree?.outputName ??
      tree?.fieldName ??
      tree?.componentName
    );
  }

  static #compile(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  static #decode(component: string): string {
    try {
      return decodeURIComponent(component.replace(/\+/g, ' '));
    } catch {
      return component;
    }
  }
}

export default Redactor;
