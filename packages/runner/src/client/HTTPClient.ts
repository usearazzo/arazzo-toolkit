import type OpenAPIOperationRequest from './OpenAPIOperationRequest.ts';

/**
 * The pluggable HTTP transport seam.
 *
 * Receives the finalized {@link OpenAPIOperationRequest} and resolves with the
 * raw WHATWG `Response`. The contract is deliberately minimal so any HTTP
 * stack (undici, got, a recording stub, …) drops in with a few lines:
 *
 * - resolve with a `Response` for every HTTP status — a non-2xx is a valid
 *   Arazzo outcome judged by a step's `successCriteria`, never an error;
 * - throw (or reject) only on transport failure — the executor wraps the
 *   error as a `ClientError`;
 * - honor `request.signal` when present.
 *
 * Response normalization (content-type dispatch, header folding) happens on
 * the executor side for every client, so `$response.body` semantics stay
 * identical no matter which transport is plugged in.
 * @public
 */
type HTTPClient = (request: OpenAPIOperationRequest) => Promise<Response>;

export default HTTPClient;
