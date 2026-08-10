// Re-export the request-building half of swagger-client and the response
// serializer, leaving the transport to the runner's pluggable HTTPClient.
//
// - buildRequest() turns a spec + operationId + parameters/securities into a
//   fully authenticated, serialized request object (url, method, headers, body).
// - deserializeResponse() parses a WHATWG Response into swagger-client's
//   serialized response shape (content-type dispatch, header folding).
//   Upstream this is serializeResponse (aliased serializeRes) — a historical
//   misnomer, corrected here at the vendor boundary.
// - idFromPathMethodLegacy() derives the operationId buildRequest resolves an
//   operation by when only a path + method pair is known (what execute() does
//   internally for the pathName/method calling convention).
// See: https://github.com/swagger-api/swagger-js/blob/master/docs/usage/http-client-for-oas-operations.md

export { buildRequest } from 'swagger-client/es/execute/index.js';
export { serializeResponse as deserializeResponse } from 'swagger-client/es/http/serializers/response/index.js';
export { default as idFromPathMethodLegacy } from 'swagger-client/es/helpers/id-from-path-method/legacy.js';
