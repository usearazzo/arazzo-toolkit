import { isPlainObject } from 'ramda-adjunct';
import { parse as parseExpression } from '@swaggerexpert/arazzo-runtime-expression';
import { unescape as unescapeToken } from '@swaggerexpert/json-pointer';
import { parse as parseMediaType } from '@swaggerexpert/media-types';

import type { ArazzoRunnerEvent } from './ArazzoRunnerEvent.ts';
import type { OpenAPIOperationEventBody } from './OpenAPIOperationEvent.ts';

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
   * Wildcard patterns of the names whose values are masked: header names,
   * query parameter names, body and output field names at any depth, and the
   * last name a criterion value is read by (`$inputs.password`,
   * `$response.header.X-Api-Key`). `*` matches any run of characters;
   * matching is case-insensitive and against the whole name, so `*token*`
   * matches `access_token` and `X-Auth-Token`.
   *
   * The list replaces {@link Redactor.defaultFields}; spread it to extend it.
   * An empty list masks nothing by name.
   */
  readonly fields?: readonly string[];
}

/**
 * Masks credentials in events before they leave the process.
 *
 * Events carry what the run saw, credentials included, the same as the
 * request a request interceptor receives: an observer is the caller's own
 * code. Pass every event through {@link Redactor.event} before logging it,
 * exporting it or writing it anywhere.
 *
 * Masking goes by name, so a credential under a name no pattern matches is
 * carried as it is. Masked are the values of matching header and query
 * parameter names, of matching fields in JSON and URL-encoded form bodies and
 * in workflow outputs, criterion values read by a matching name, the names an
 * exchange event lists as `credentials` (where the document's security
 * schemes put them), and, whatever the patterns, the userinfo of every URL.
 * A body that is neither JSON nor a URL-encoded form keeps only its size, as
 * it cannot be masked field by field; a masked body's text is cut to
 * {@link Redactor.BODY_LIMIT} characters. The masked value is `REDACTED`.
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

  /**
   * The HTTP headers whose value is a URL.
   */
  static readonly #URL_HEADERS: ReadonlySet<string> = new Set(['location', 'content-location']);

  readonly #patterns: readonly RegExp[];

  constructor(options: RedactorOptions = {}) {
    this.#patterns = (options.fields ?? Redactor.defaultFields).map(Redactor.#compile);
  }

  /**
   * A copy of the event with its credentials masked. An event that carries
   * nothing to mask comes back as it is.
   */
  event<E extends ArazzoRunnerEvent>(event: E): E {
    const masked = this.#masked(event as ArazzoRunnerEvent);
    if ('path' in masked) {
      return { ...masked, path: masked.path.map((entry) => this.#url(entry)) } as unknown as E;
    }
    return masked as unknown as E;
  }

  #masked(event: ArazzoRunnerEvent): ArazzoRunnerEvent {
    switch (event.type) {
      case 'workflow-settled':
        return { ...event, outputs: this.#value(event.outputs, []) as Record<string, unknown> };
      case 'criterion-evaluated':
        return {
          ...event,
          criterion: { ...event.criterion, values: this.#expressions(event.criterion.values) },
        };
      case 'dependency-start':
      case 'dependency-settled':
        return {
          ...event,
          dependency: { ...event.dependency, documentURI: this.#url(event.dependency.documentURI) },
        };
      case 'document-load-start':
      case 'document-load-settled':
        return { ...event, uri: this.#url(event.uri) };
      case 'openapi-operation-request-start': {
        const { request, credentials } = event;
        return {
          ...this.#operation(event),
          request: {
            ...request,
            url: this.#url(request.url, credentials),
            headers: this.#headers(request.headers, credentials),
            ...this.#bodyOf(request.body, request.headers, credentials),
          },
        };
      }
      case 'openapi-operation-request-settled': {
        const { response, credentials } = event;
        return {
          ...this.#operation(event),
          response: {
            ...response,
            headers: this.#headers(response.headers, credentials),
            ...this.#bodyOf(response.body, response.headers, credentials),
          },
        };
      }
      case 'openapi-operation-normalize-start':
      case 'openapi-operation-normalize-settled':
      case 'openapi-operation-assembled':
        return this.#operation(event);
      default:
        return event;
    }
  }

  /**
   * An OpenAPI operation event with the document URI it names masked.
   */
  #operation<E extends Extract<ArazzoRunnerEvent, { operation: { documentURI: string } }>>(
    event: E,
  ): E {
    return {
      ...event,
      operation: { ...event.operation, documentURI: this.#url(event.operation.documentURI) },
    };
  }

  #masks(name: string, extra: readonly string[]): boolean {
    const lowered = name.toLowerCase();
    return (
      this.#patterns.some((pattern) => pattern.test(name)) ||
      extra.some((candidate) => candidate.toLowerCase() === lowered)
    );
  }

  /**
   * Headers with masked values replaced, and the URL a `Location` or
   * `Content-Location` header carries masked like a request URL.
   */
  #headers(
    headers: Readonly<Record<string, string>>,
    extra: readonly string[],
  ): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (this.#masks(name, extra)) redacted[name] = Redactor.CENSOR;
      else if (Redactor.#URL_HEADERS.has(name.toLowerCase())) {
        redacted[name] = this.#url(value, extra);
      } else redacted[name] = value;
    }
    return redacted;
  }

  /**
   * The URL with its userinfo and masked query values replaced. Worked on as
   * a string, not through `URL`, so the rest keeps the encoding it was sent
   * with; a value that is no URL comes back as it was.
   */
  #url(url: string, extra: readonly string[] = []): string {
    // up to the last `@` before the path, as URL parsers split userinfo from
    // the host; a scheme-relative `//user@host` counts too.
    const withoutUserinfo = url.replace(
      /^((?:[a-z][a-z\d+.-]*:)?\/\/)[^/?#]*@/i,
      `$1${Redactor.CENSOR}:${Redactor.CENSOR}@`,
    );

    const queryStart = withoutUserinfo.indexOf('?');
    if (queryStart === -1) return withoutUserinfo;
    const fragmentStart = withoutUserinfo.indexOf('#', queryStart);
    const queryEnd = fragmentStart === -1 ? withoutUserinfo.length : fragmentStart;
    const query = this.#form(withoutUserinfo.slice(queryStart + 1, queryEnd), extra);
    return `${withoutUserinfo.slice(0, queryStart + 1)}${query}${withoutUserinfo.slice(queryEnd)}`;
  }

  /**
   * A copy of `value` with the values of masked fields replaced, at any depth.
   */
  #value(value: unknown, extra: readonly string[]): unknown {
    if (Array.isArray(value)) return value.map((item) => this.#value(item, extra));
    if (!isPlainObject(value)) return value;

    const redacted: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
      Redactor.#define(
        redacted,
        name,
        this.#masks(name, extra) ? Redactor.CENSOR : this.#value(item, extra),
      );
    }
    return redacted;
  }

  /**
   * Criterion values keyed by the runtime expression that read them, masked
   * whole when the expression's last name matches (`$inputs.password`,
   * `$request.header.Authorization`, `$response.body#/token`), otherwise
   * field by field; `$url` is masked like a URL.
   */
  #expressions(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [expression, value] of Object.entries(values)) {
      let masked: unknown;
      const name = Redactor.#lastName(expression);
      if (name !== undefined && this.#masks(name, [])) masked = Redactor.CENSOR;
      else if (expression === '$url' && typeof value === 'string') masked = this.#url(value);
      else masked = this.#value(value, []);
      Redactor.#define(redacted, expression, masked);
    }
    return redacted;
  }

  /**
   * The `body` an exchange event carries, masked, as a spreadable field: a JSON
   * or URL-encoded form body masked field by field and cut to
   * {@link Redactor.BODY_LIMIT} characters, any other body reduced to its size.
   */
  #bodyOf(
    body: OpenAPIOperationEventBody | undefined,
    headers: Readonly<Record<string, string>>,
    extra: readonly string[],
  ): { body?: OpenAPIOperationEventBody } {
    if (body === undefined) return {};
    const { text, ...rest } = body;
    const masked =
      text === undefined ? undefined : this.#text(text, Redactor.#contentType(headers), extra);
    if (masked === undefined) return { body: rest };
    return masked.length > Redactor.BODY_LIMIT
      ? { body: { ...rest, text: masked.slice(0, Redactor.BODY_LIMIT), truncated: true } }
      : { body: { ...rest, text: masked } };
  }

  #text(
    text: string,
    mediaType: MediaType | undefined,
    extra: readonly string[],
  ): string | undefined {
    if (mediaType?.subtype === 'json' || mediaType?.suffix === 'json') {
      if (text === '') return text;
      try {
        return JSON.stringify(this.#value(JSON.parse(text), extra));
      } catch {
        return undefined;
      }
    }
    if (mediaType?.type === 'application' && mediaType.subtype === 'x-www-form-urlencoded') {
      return this.#form(text, extra);
    }
    return undefined;
  }

  /**
   * `name=value` pairs joined by `&`, with masked values replaced and every
   * other pair left as it was.
   */
  #form(pairs: string, extra: readonly string[]): string {
    return pairs
      .split('&')
      .map((pair) => {
        const separator = pair.indexOf('=');
        if (separator === -1) return pair;
        const name = pair.slice(0, separator);
        return this.#masks(Redactor.#decode(name), extra) ? `${name}=${Redactor.CENSOR}` : pair;
      })
      .join('&');
  }

  /**
   * Defines, rather than assigns, so an own `__proto__` key stays data.
   */
  static #define(target: Record<string, unknown>, name: string, value: unknown): void {
    Object.defineProperty(target, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  /**
   * The media type the `Content-Type` header names, whatever the header's
   * case; `undefined` without one or for one that does not parse.
   */
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
   * The last name a runtime expression reads: the last token of its JSON
   * Pointer when it has one, else the header, query, path, input, output or
   * component name it names. `undefined` for an expression that names none
   * (`$statusCode`) or does not parse.
   */
  static #lastName(expression: string): string | undefined {
    let tree: ExpressionNode | undefined;
    try {
      tree = parseExpression(expression).tree as ExpressionNode | undefined;
    } catch {
      return undefined;
    }
    if (tree === undefined) return undefined;

    const reference = tree.source?.reference;
    const pointer = tree.jsonPointer ?? reference?.jsonPointer;
    const token = pointer?.referenceTokens.at(-1)?.value;
    if (token !== undefined) return unescapeToken(token);
    return (
      reference?.token ??
      reference?.name ??
      tree.name ??
      tree.outputName ??
      tree.fieldName ??
      tree.componentName
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
