import { parse } from '@swaggerexpert/media-types';

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
 * content-type dispatch (JSON/XML/YAML/text vs binary) means the response
 * model runtime expressions and criteria see is defined here, on the runner's
 * side of the {@link HTTPClient} seam, and stays identical across transports.
 * Headers are taken from the `Response` directly rather than from the
 * deserializer, which splits every value containing `", "` into an array:
 * values stay strings as sent, with repeated fields (`Set-Cookie` included)
 * combined by `Headers.get`. The body is read once, as bytes, and handed to the
 * deserializer from memory. A body that decodes as UTF-8 without loss is kept
 * as that one string, the same one the deserializer parses, so a plain-text or
 * XML `body` shares it; any other body (binary, another charset, a leading
 * byte-order mark) is kept as the bytes, so they are never re-encoded lossily.
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
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = this.#decodeLosslessly(bytes);
    // the deserializer matches the raw Content-Type case-sensitively and against
    // its parameters too, so it is handed only the parsed essence; the response's
    // own `headers` below stay as sent.
    const deserializerHeaders = new Headers(response.headers);
    const contentType = response.headers.get('content-type');
    const mediaType =
      contentType === null ? undefined : parse(contentType, { type: 'media-type' }).tree;
    if (mediaType !== undefined) {
      deserializerHeaders.set('content-type', `${mediaType.type}/${mediaType.subtype}`);
    }
    // the deserializer only reads the body through text() or blob(), by content
    // type; answering from memory spares a second copy of the stream.
    const deserialized = await deserializeResponse(
      {
        ok: response.ok,
        url: response.url,
        status: response.status,
        statusText: response.statusText,
        headers: deserializerHeaders,
        text: async () => text ?? new TextDecoder().decode(bytes),
        blob: async () => new Blob([bytes]),
      },
      request?.url,
    );
    const headers = Object.fromEntries(
      Array.from(response.headers.keys(), (name) => [name, response.headers.get(name) as string]),
    );

    return new OpenAPIOperationResponse({
      ok: deserialized.ok as boolean,
      url: deserialized.url as string,
      status: deserialized.status as number,
      statusText: deserialized.statusText as string,
      headers,
      body: deserialized.body,
      content: text ?? bytes,
      request,
    });
  }

  /**
   * The bytes as a string that encodes back to exactly them, or `undefined`
   * when there is none: invalid UTF-8, or a leading byte-order mark, which
   * decoding strips.
   */
  #decodeLosslessly(bytes: Uint8Array): string | undefined {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return undefined;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }
}

export default OpenAPIOperationResponseNormalizer;
