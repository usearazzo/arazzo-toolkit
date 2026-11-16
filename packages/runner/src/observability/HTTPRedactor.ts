/**
 * What to mask in the HTTP data an event carries.
 *
 * A list replaces its default, so extend a default by spreading it, e.g.
 * `{ headers: [...OpenAPIOperationExecutor.defaultRedact.headers, 'x-session'] }`.
 * A list left out keeps its default.
 * @public
 */
export interface HTTPRedactOptions {
  /**
   * Header names whose values are masked, matched case-insensitively.
   */
  readonly headers?: readonly string[];
  /**
   * Query parameter names whose values are masked, matched exactly.
   */
  readonly query?: readonly string[];
}

/**
 * Masks credentials in the URL and headers of an HTTP exchange before an event
 * carries them, following OpenTelemetry's HTTP conventions: a URL's userinfo
 * becomes `REDACTED:REDACTED`, and the value of a listed query parameter or
 * header becomes `REDACTED`. Everything else is left exactly as it was sent.
 * @internal
 */
class HTTPRedactor {
  static readonly CENSOR = 'REDACTED';

  /**
   * The headers that carry credentials in any API, and the query parameters
   * OpenTelemetry's conventions mask in a URL (signed-URL signatures and keys).
   */
  static readonly DEFAULTS = {
    headers: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'],
    query: ['AWSAccessKeyId', 'Signature', 'sig', 'X-Goog-Signature'],
  } as const satisfies Required<HTTPRedactOptions>;

  readonly #headers: readonly string[];
  readonly #query: readonly string[];

  constructor(options: HTTPRedactOptions = {}) {
    this.#headers = options.headers ?? HTTPRedactor.DEFAULTS.headers;
    this.#query = options.query ?? HTTPRedactor.DEFAULTS.query;
  }

  /**
   * The headers with the values of masked names replaced. `extra` names are
   * masked on top of the configured list, which is how a request's own
   * security-scheme credentials are always masked.
   */
  headers(
    headers: Iterable<readonly [string, string]>,
    extra: readonly string[] = [],
  ): Record<string, string> {
    const masked = new Set([...this.#headers, ...extra].map((name) => name.toLowerCase()));
    const redacted: Record<string, string> = {};
    for (const [name, value] of headers) {
      redacted[name] = masked.has(name.toLowerCase()) ? HTTPRedactor.CENSOR : value;
    }
    return redacted;
  }

  /**
   * The URL with its userinfo and the values of masked query parameters
   * replaced. Worked on as a string, not through `URL`, so the rest of the URL
   * keeps the encoding it was sent with.
   */
  url(url: string, extra: readonly string[] = []): string {
    const masked = new Set([...this.#query, ...extra]);
    const withoutUserinfo = url.replace(
      /^([a-z][a-z\d+.-]*:\/\/)[^/?#@]*@/i,
      `$1${HTTPRedactor.CENSOR}:${HTTPRedactor.CENSOR}@`,
    );

    const queryStart = withoutUserinfo.indexOf('?');
    if (queryStart === -1) return withoutUserinfo;
    const fragmentStart = withoutUserinfo.indexOf('#', queryStart);
    const queryEnd = fragmentStart === -1 ? withoutUserinfo.length : fragmentStart;

    const query = withoutUserinfo
      .slice(queryStart + 1, queryEnd)
      .split('&')
      .map((pair) => {
        const separator = pair.indexOf('=');
        if (separator === -1) return pair;
        const name = pair.slice(0, separator);
        return masked.has(HTTPRedactor.#decode(name)) ? `${name}=${HTTPRedactor.CENSOR}` : pair;
      })
      .join('&');
    return `${withoutUserinfo.slice(0, queryStart + 1)}${query}${withoutUserinfo.slice(queryEnd)}`;
  }

  static #decode(component: string): string {
    try {
      return decodeURIComponent(component.replace(/\+/g, ' '));
    } catch {
      return component;
    }
  }
}

export default HTTPRedactor;
