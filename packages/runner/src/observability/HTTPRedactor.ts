/**
 * What to mask in the HTTP data an event carries.
 *
 * Masking goes by name: a credential sent under a name no list holds (a
 * custom header a request interceptor adds, say) is carried as it is. A list
 * replaces its default, so extend a default by spreading it, e.g.
 * `{ headers: [...OpenAPIOperationExecutor.defaultRedact.headers, 'x-session'] }`;
 * a list left out keeps its default, and an empty list masks nothing by name.
 * @public
 */
export interface HTTPRedactOptions {
  /**
   * Header names whose values are masked, matched case-insensitively.
   */
  readonly headers?: readonly string[];
  /**
   * Query parameter names whose values are masked, matched case-insensitively
   * after percent-decoding.
   */
  readonly query?: readonly string[];
}

/**
 * Headers as a `Response` exposes them, the part the runner reads.
 */
interface HeaderSource {
  keys(): Iterable<string>;
  get(name: string): string | null;
}

/**
 * Names masked for one exchange on top of the configured lists.
 */
interface ExtraNames {
  readonly headers: readonly string[];
  readonly query: readonly string[];
}

/**
 * Masks credentials in the URL and headers of an HTTP exchange before an event
 * carries them, following OpenTelemetry's HTTP conventions: a URL's userinfo
 * becomes `REDACTED:REDACTED`, and the value of a listed query parameter or
 * header becomes `REDACTED`. A URL inside a `Location` or `Content-Location`
 * header is masked the same way. Everything else keeps the value it was sent
 * with.
 * @internal
 */
class HTTPRedactor {
  static readonly CENSOR = 'REDACTED';

  /**
   * The headers that carry credentials in any API, and the query parameters
   * OpenTelemetry's conventions mask in a URL (signed-URL signatures and keys).
   */
  static readonly DEFAULTS: Required<HTTPRedactOptions> = Object.freeze({
    headers: Object.freeze(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']),
    query: Object.freeze(['AWSAccessKeyId', 'Signature', 'sig', 'X-Goog-Signature']),
  });

  static readonly #URL_HEADERS: ReadonlySet<string> = new Set(['location', 'content-location']);
  static readonly #NONE: ExtraNames = { headers: [], query: [] };

  readonly #headers: ReadonlySet<string>;
  readonly #query: ReadonlySet<string>;

  constructor(options: HTTPRedactOptions = {}) {
    this.#headers = HTTPRedactor.#lowercased(options.headers ?? HTTPRedactor.DEFAULTS.headers);
    this.#query = HTTPRedactor.#lowercased(options.query ?? HTTPRedactor.DEFAULTS.query);
  }

  /**
   * The headers with the values of masked names replaced. `extra` names are
   * masked on top of the configured list, which is how a request's own
   * security-scheme credentials are always masked. A repeated response header
   * is read joined, as `$response.header` reads it.
   */
  headers(
    source: Readonly<Record<string, string>> | HeaderSource,
    extra: ExtraNames = HTTPRedactor.#NONE,
  ): Record<string, string> {
    const masked = HTTPRedactor.#lowercased(extra.headers);
    const entries = HTTPRedactor.#isHeaderSource(source)
      ? [...source.keys()].map((name) => [name, source.get(name) ?? ''] as const)
      : Object.entries(source);

    const redacted: Record<string, string> = {};
    for (const [name, value] of entries) {
      const lowered = name.toLowerCase();
      if (this.#headers.has(lowered) || masked.has(lowered)) {
        redacted[name] = HTTPRedactor.CENSOR;
      } else {
        redacted[name] = HTTPRedactor.#URL_HEADERS.has(lowered)
          ? this.url(value, extra.query)
          : value;
      }
    }
    return redacted;
  }

  /**
   * The URL with its userinfo and the values of masked query parameters
   * replaced. Worked on as a string, not through `URL`, so the rest of the URL
   * keeps the encoding it was sent with.
   */
  url(url: string, extra: readonly string[] = []): string {
    const masked = HTTPRedactor.#lowercased(extra);
    // up to the last `@` before the path, as URL parsers split userinfo from
    // the host; a scheme-relative `//user@host` counts too.
    const withoutUserinfo = url.replace(
      /^((?:[a-z][a-z\d+.-]*:)?\/\/)[^/?#]*@/i,
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
        const lowered = HTTPRedactor.#decode(name).toLowerCase();
        return this.#query.has(lowered) || masked.has(lowered)
          ? `${name}=${HTTPRedactor.CENSOR}`
          : pair;
      })
      .join('&');
    return `${withoutUserinfo.slice(0, queryStart + 1)}${query}${withoutUserinfo.slice(queryEnd)}`;
  }

  static #lowercased(names: readonly string[]): ReadonlySet<string> {
    return new Set(names.map((name) => name.toLowerCase()));
  }

  static #isHeaderSource(source: unknown): source is HeaderSource {
    return typeof (source as HeaderSource).get === 'function';
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
