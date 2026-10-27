import { assert } from 'chai';

import { OpenAPIOperationResponseNormalizer, OpenAPIOperationResponse } from '../../src/index.ts';

describe('OpenAPIOperationResponseNormalizer', function () {
  const normalizer = new OpenAPIOperationResponseNormalizer();

  specify('should parse a JSON body by content type', async function () {
    const raw = new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });

    const response = await normalizer.normalize(raw);

    assert.instanceOf(response, OpenAPIOperationResponse);
    assert.isTrue(response.ok);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.text(), '{"id":7,"name":"Rex"}');
    assert.deepEqual(response.body, { id: 7, name: 'Rex' });
    assert.strictEqual(response.headers['content-type'], 'application/json');
  });

  specify('should map a non-2xx response as data, preserving its status', async function () {
    const raw = new Response(JSON.stringify({ message: 'boom' }), {
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'application/json' },
    });

    const response = await normalizer.normalize(raw);

    assert.isFalse(response.ok);
    assert.strictEqual(response.status, 500);
    assert.deepEqual(response.body, { message: 'boom' });
  });

  specify('should fall back to the request URL when the Response carries none', async function () {
    // a constructed Response (e.g. from a stub transport) has an empty url.
    const raw = new Response('{}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });
    const request = { url: 'https://example.com/api/v3/pet/7', method: 'GET', headers: {} };

    const response = await normalizer.normalize(raw, request);

    assert.strictEqual(response.url, 'https://example.com/api/v3/pet/7');
    assert.strictEqual(response.request, request);
  });

  specify('should leave the body unset for a 204 with no content', async function () {
    const raw = new Response(null, { status: 204, statusText: 'No Content' });

    const response = await normalizer.normalize(raw);

    assert.isTrue(response.ok);
    assert.strictEqual(response.status, 204);
    assert.strictEqual(response.text(), '');
    assert.strictEqual(response.bytes().length, 0);
    assert.isUndefined(response.body);
  });

  specify('should read an empty body for a 304 with no content', async function () {
    const raw = new Response(null, { status: 304, statusText: 'Not Modified' });

    const response = await normalizer.normalize(raw);

    assert.strictEqual(response.status, 304);
    assert.strictEqual(response.text(), '');
    assert.strictEqual(response.blob().size, 0);
  });

  specify('should read an empty body for a zero-length body of any type', async function () {
    for (const [payload, type] of [
      ['', 'application/json'],
      [new Uint8Array(0), 'image/png'],
    ] as const) {
      const response = await normalizer.normalize(
        new Response(payload, { status: 200, headers: { 'content-type': type } }),
      );

      assert.strictEqual(response.text(), '', type);
      assert.strictEqual(response.bytes().length, 0, type);
      assert.strictEqual(response.blob().size, 0, type);
    }
  });

  specify('should read a binary body as received', async function () {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const raw = new Response(png, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png' },
    });

    const response = await normalizer.normalize(raw);
    const blob = response.blob();

    assert.deepEqual(response.bytes(), png);
    assert.strictEqual(response.text(), new TextDecoder().decode(png));
    assert.strictEqual(blob.type, 'image/png');
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), png);
    assert.isUndefined(response.body);
  });

  specify('should return a fresh copy of the bytes on every read', async function () {
    // one textual body (held as a string) and one binary (held as bytes).
    for (const [received, type] of [
      [new TextEncoder().encode('{}'), 'application/json'],
      [new Uint8Array([0x89, 0x50]), 'image/png'],
    ] as const) {
      const response = await normalizer.normalize(
        new Response(received.slice(), { status: 200, headers: { 'content-type': type } }),
      );
      response.bytes().fill(0);

      assert.deepEqual(response.bytes(), received, type);
    }
  });

  specify('should read a textual body through every method', async function () {
    const raw = new Response('<pet>Café</pet>', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/xml' },
    });

    const response = await normalizer.normalize(raw);
    const blob = response.blob();

    assert.strictEqual(response.text(), '<pet>Café</pet>');
    assert.strictEqual(response.body, '<pet>Café</pet>');
    assert.deepEqual(response.bytes(), new TextEncoder().encode('<pet>Café</pet>'));
    assert.strictEqual(blob.type, 'application/xml');
    assert.strictEqual(await blob.text(), '<pet>Café</pet>');
  });

  specify('should return the bytes received for a body in another charset', async function () {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    const raw = new Response(latin1, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain; charset=iso-8859-1' },
    });

    const response = await normalizer.normalize(raw);

    assert.deepEqual(response.bytes(), latin1);
    assert.deepEqual(new Uint8Array(await response.blob().arrayBuffer()), latin1);
    assert.strictEqual(response.text(), 'caf\uFFFD');
  });

  specify('should return the bytes received for a body with a byte-order mark', async function () {
    const withBOM = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
    const raw = new Response(withBOM, {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    });

    const response = await normalizer.normalize(raw);

    assert.deepEqual(response.bytes(), withBOM);
    assert.strictEqual(response.text(), '{}');
    assert.deepEqual(response.body, {});
  });

  specify('should type the blob empty when the response has no content type', async function () {
    const raw = new Response(new Uint8Array([1, 2, 3]), { status: 200, statusText: 'OK' });
    raw.headers.delete('content-type');

    const response = await normalizer.normalize(raw);

    assert.strictEqual(response.blob().type, '');
    assert.deepEqual(response.bytes(), new Uint8Array([1, 2, 3]));
  });

  specify('should parse a body whose media type is not lower-cased', async function () {
    const raw = new Response('{"id":7}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'Application/JSON; Charset=UTF-8' },
    });

    const response = await normalizer.normalize(raw);

    assert.deepEqual(response.body, { id: 7 });
    assert.strictEqual(response.headers['content-type'], 'Application/JSON; Charset=UTF-8');
  });

  specify('should not read a binary body as text because of a parameter', async function () {
    const raw = new Response(new Uint8Array([0x89, 0x50]), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/octet-stream; name=text' },
    });

    const response = await normalizer.normalize(raw);

    assert.isUndefined(response.body);
    assert.deepEqual(response.bytes(), new Uint8Array([0x89, 0x50]));
  });

  specify('should keep header values containing commas as sent', async function () {
    const raw = new Response('{}', {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-cache, no-store',
        date: 'Thu, 22 Oct 2026 11:45:22 GMT',
      },
    });

    const response = await normalizer.normalize(raw);

    assert.strictEqual(response.headers['cache-control'], 'no-cache, no-store');
    assert.strictEqual(response.headers.date, 'Thu, 22 Oct 2026 11:45:22 GMT');
  });

  specify('should combine repeated header fields into one string', async function () {
    const raw = new Response('{}', {
      status: 200,
      statusText: 'OK',
      headers: [
        ['content-type', 'application/json'],
        ['vary', 'Accept'],
        ['vary', 'Origin'],
        ['set-cookie', 'a=1'],
        ['set-cookie', 'b=2'],
      ],
    });

    const response = await normalizer.normalize(raw);

    assert.strictEqual(response.headers.vary, 'Accept, Origin');
    assert.strictEqual(response.headers['set-cookie'], 'a=1, b=2');
  });
});
