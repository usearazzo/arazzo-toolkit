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
 * @public
 */
class OpenAPIOperationResponse {
  readonly ok: boolean;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly text: string;
  readonly body: unknown;
  readonly request: OpenAPIOperationRequestInfo | undefined;

  constructor(raw: {
    ok: boolean;
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    text: string;
    body: unknown;
    request?: OpenAPIOperationRequestInfo;
  }) {
    this.ok = raw.ok;
    this.url = raw.url;
    this.status = raw.status;
    this.statusText = raw.statusText;
    this.headers = raw.headers;
    this.text = raw.text;
    this.body = raw.body;
    this.request = raw.request;
  }
}

export default OpenAPIOperationResponse;
