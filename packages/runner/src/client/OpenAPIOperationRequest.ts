/**
 * The HTTP request built for an OpenAPI operation.
 *
 * Produced by the vendored swagger-client `buildRequest` from the assembled
 * single-operation document — the URL is fully resolved (server + path +
 * serialized query string), parameters are serialized per their style/explode
 * rules, and securities are already applied to headers/query. The object is
 * intentionally mutable: request interceptors may edit it (or return a
 * replacement) before it is handed to the {@link HTTPClient}.
 *
 * The open tail carries whatever extra fields a builder attaches; the default
 * transport passes the whole object as fetch init, so standard `RequestInit`
 * fields (`credentials`, `signal`, …) take effect on the wire.
 * @public
 */
interface OpenAPIOperationRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  credentials?: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export default OpenAPIOperationRequest;
