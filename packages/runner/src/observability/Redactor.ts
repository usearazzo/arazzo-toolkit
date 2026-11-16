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
 * absolute URL has its userinfo masked and its matching query values, as the
 * `URL` constructor parses it. A request or
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
    if (typeof value === 'string') return URL.canParse(value) ? this.#url(value) : value;
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
   * field name it reads.
   */
  #masks(name: string): boolean {
    const target = name.startsWith('$') ? Redactor.#fieldName(name) : name;
    return target !== undefined && this.#patterns.some((pattern) => pattern.test(target));
  }

  /**
   * The absolute URL with its userinfo and matching query values masked. A
   * URL with nothing to mask comes back exactly as it was, not normalized.
   */
  #url(value: string): string {
    const url = new URL(value);
    let masked = false;
    if (url.username !== '' || url.password !== '') {
      url.username = Redactor.CENSOR;
      url.password = Redactor.CENSOR;
      masked = true;
    }
    const query = this.#params(url.search);
    if (query !== undefined) {
      url.search = query;
      masked = true;
    }
    return masked ? url.href : value;
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
        masked = this.#params(body) ?? body;
      } else masked = Redactor.CENSOR;
    }

    const text = typeof masked === 'string' ? masked : JSON.stringify(masked);
    return text !== undefined && text.length > Redactor.BODY_LIMIT
      ? `${text.slice(0, Redactor.BODY_LIMIT)}…`
      : masked;
  }

  /**
   * URL-encoded `name=value` pairs with matching values masked, or
   * `undefined` when none matches, so the caller keeps the text as it was.
   */
  #params(text: string): string | undefined {
    const params = [...new URLSearchParams(text)];
    if (!params.some(([name]) => this.#masks(name))) return undefined;
    const masked = params.map(([name, value]) => [
      name,
      this.#masks(name) ? Redactor.CENSOR : value,
    ]);
    return new URLSearchParams(masked).toString();
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
   * The field name a runtime expression reads: `password` for
   * `$inputs.password`, `Authorization` for `$request.header.Authorization`,
   * `access_token` for `$response.body#/access_token` (a JSON Pointer's last
   * token). `undefined` for one that reads no named field (`$statusCode`) or
   * does not parse.
   */
  static #fieldName(expression: string): string | undefined {
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
}

export default Redactor;
