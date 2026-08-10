import type HTTPClient from './HTTPClient.ts';

/**
 * The default {@link HTTPClient}: global fetch.
 *
 * Mirrors swagger-client's own transport line — the request object doubles as
 * fetch init, so `method`, `headers`, `body`, `credentials`, and `signal` are
 * picked up from it directly.
 * @public
 */
const httpClientFetch: HTTPClient = (request) => fetch(request.url, request as RequestInit);

export default httpClientFetch;
