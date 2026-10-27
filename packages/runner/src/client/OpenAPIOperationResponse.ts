/**
 * The HTTP request an OpenAPI operation was executed with.
 *
 * An immutable snapshot of the request as actually sent, recorded by the
 * executor after the interceptors ran and before the transport was called, so
 * runtime expressions (`$url`, `$method`, `$request.header.*`, `$request.body`)
 * can be evaluated against it after execution. `headers` is a copy taken at
 * capture time; `body` shares its reference with the sent request.
 * @public
 */
export interface OpenAPIOperationRequestInfo {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/**
 * Response from an OpenAPI operation execution.
 *
 * `body` is the payload parsed by its content type, what `$response.body`
 * reads. The body as received is read through `text()`, `blob()` and
 * `bytes()`, named after the WHATWG `Response` methods but synchronous, and
 * empty when the response carried no body (e.g. `204`, `304`). `bytes()` and
 * `blob()` always return the bytes received. A body that is valid UTF-8 is held
 * as its decoded string, which a plain-text or XML `body` shares rather than
 * duplicates, and is encoded back on read; any other body is held as bytes.
 * @public
 */
class OpenAPIOperationResponse {
  readonly ok: boolean;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly request: OpenAPIOperationRequestInfo | undefined;
  readonly #content: string | Uint8Array;

  constructor(raw: {
    ok: boolean;
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
    content: string | Uint8Array;
    request?: OpenAPIOperationRequestInfo;
  }) {
    this.ok = raw.ok;
    this.url = raw.url;
    this.status = raw.status;
    this.statusText = raw.statusText;
    this.headers = raw.headers;
    this.body = raw.body;
    this.#content = raw.content;
    this.request = raw.request;
  }

  /**
   * The body as text, like `Response.text()`; `''` when there is none.
   */
  text(): string {
    return typeof this.#content === 'string'
      ? this.#content
      : new TextDecoder().decode(this.#content);
  }

  /**
   * The body as a `Blob` typed by the response's `Content-Type`, like
   * `Response.blob()`.
   */
  blob(): Blob {
    // the lib types only take ArrayBuffer-backed views; the normalizer never
    // produces a shared one.
    return new Blob([this.#content as string | Uint8Array<ArrayBuffer>], {
      type: this.headers['content-type'] ?? '',
    });
  }

  /**
   * The body as bytes, like `Response.bytes()`; a fresh copy on every call, so
   * the response stays immutable.
   */
  bytes(): Uint8Array {
    return typeof this.#content === 'string'
      ? new TextEncoder().encode(this.#content)
      : this.#content.slice();
  }
}

export default OpenAPIOperationResponse;
