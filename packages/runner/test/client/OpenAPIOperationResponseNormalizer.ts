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
    assert.strictEqual(response.text, '{"id":7,"name":"Rex"}');
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
    assert.isUndefined(response.body);
  });
});
