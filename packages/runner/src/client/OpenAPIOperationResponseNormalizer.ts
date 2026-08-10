// @ts-expect-error vendored swagger-client bundle has no type declarations
import { deserializeResponse } from '../vendor/swagger-client.mjs';
import OpenAPIOperationResponse, {
  type OpenAPIOperationRequestInfo,
} from './OpenAPIOperationResponse.ts';

/**
 * Normalizes a raw WHATWG `Response` into an {@link OpenAPIOperationResponse}.
 *
 * Wraps the vendored swagger-client response deserializer (upstream
 * `serializeRes`, aliased at the vendor boundary), whose battle-tested
 * content-type dispatch (JSON/XML/YAML/text vs binary, header folding) means
 * the response model runtime expressions and criteria see is defined here,
 * on the runner's side of the {@link HTTPClient} seam, and stays identical
 * across transports.
 * @public
 */
class OpenAPIOperationResponseNormalizer {
  /**
   * Deserializes the response body by content type and maps the result into the
   * runner's response model. `request` is the request the operation was
   * executed with; its `url` doubles as the fallback when the `Response`
   * carries none (e.g. a stubbed transport).
   */
  async normalize(
    response: Response,
    request?: OpenAPIOperationRequestInfo,
  ): Promise<OpenAPIOperationResponse> {
    const deserialized = await deserializeResponse(response, request?.url);

    return new OpenAPIOperationResponse({
      ok: deserialized.ok as boolean,
      url: deserialized.url as string,
      status: deserialized.status as number,
      statusText: deserialized.statusText as string,
      headers: deserialized.headers as Record<string, string>,
      text: deserialized.text as string,
      body: deserialized.body,
      request,
    });
  }
}

export default OpenAPIOperationResponseNormalizer;
