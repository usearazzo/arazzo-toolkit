import { assert } from 'chai';

import HTTPRedactor from '../../src/observability/HTTPRedactor.ts';

describe('HTTPRedactor', function () {
  context('headers', function () {
    specify('should mask the default credential headers, whatever their case', function () {
      const headers = new HTTPRedactor().headers({
        Authorization: 'Bearer secret',
        cookie: 'session=1',
        'Set-Cookie': 'session=2',
        'Proxy-Authorization': 'Basic x',
        Accept: 'application/json',
      });

      assert.deepEqual(headers, {
        Authorization: 'REDACTED',
        cookie: 'REDACTED',
        'Set-Cookie': 'REDACTED',
        'Proxy-Authorization': 'REDACTED',
        Accept: 'application/json',
      });
    });

    specify('should replace the default list, and still mask the extra names', function () {
      const redactor = new HTTPRedactor({ headers: ['x-session'] });

      const headers = redactor.headers(
        { Authorization: 'Bearer secret', 'X-Session': 's', api_key: 'k' },
        { headers: ['api_key'], query: [] },
      );

      assert.deepEqual(headers, {
        Authorization: 'Bearer secret',
        'X-Session': 'REDACTED',
        api_key: 'REDACTED',
      });
    });
  });

  context('response headers', function () {
    specify('should read repeated headers joined, as $response.header does', function () {
      const headers = new Headers();
      headers.append('Set-Cookie', 'a=1');
      headers.append('Set-Cookie', 'b=2');

      const redacted = new HTTPRedactor({ headers: [] }).headers(headers);

      assert.strictEqual(redacted['set-cookie'], headers.get('set-cookie'));
    });

    specify('should mask credentials in a URL a Location header carries', function () {
      const headers = new Headers({
        Location: 'https://u:p@api.example.com/x?Signature=s&key=k&page=2',
      });

      const redacted = new HTTPRedactor().headers(headers, { headers: [], query: ['key'] });

      assert.strictEqual(
        redacted.location,
        'https://REDACTED:REDACTED@api.example.com/x?Signature=REDACTED&key=REDACTED&page=2',
      );
    });

    specify('should read headers that are not iterable through keys and get', function () {
      const headers = {
        keys: () => ['authorization', 'accept'][Symbol.iterator](),
        get: (name: string) => (name === 'accept' ? 'text/plain' : 'secret'),
      };

      assert.deepEqual(new HTTPRedactor().headers(headers), {
        authorization: 'REDACTED',
        accept: 'text/plain',
      });
    });
  });

  specify('should keep its defaults frozen', function () {
    assert.isTrue(Object.isFrozen(HTTPRedactor.DEFAULTS));
    assert.isTrue(Object.isFrozen(HTTPRedactor.DEFAULTS.headers));
    assert.isTrue(Object.isFrozen(HTTPRedactor.DEFAULTS.query));
  });

  context('url', function () {
    specify('should mask userinfo', function () {
      assert.strictEqual(
        new HTTPRedactor().url('https://user:pass@api.example.com/pets'),
        'https://REDACTED:REDACTED@api.example.com/pets',
      );
    });

    specify('should mask listed query values and leave the rest as sent', function () {
      const url =
        'https://api.example.com/f?a=%20b+c&Signature=xyz&sig=1&sig=2&flag#frag?Signature=keep';

      assert.strictEqual(
        new HTTPRedactor().url(url),
        'https://api.example.com/f?a=%20b+c&Signature=REDACTED&sig=REDACTED&sig=REDACTED&flag#frag?Signature=keep',
      );
    });

    specify('should match an encoded parameter name, and mask the extra names', function () {
      const url = 'https://api.example.com/f?X%2DGoog%2DSignature=s&key=k&page=2';

      assert.strictEqual(
        new HTTPRedactor().url(url, ['key']),
        'https://api.example.com/f?X%2DGoog%2DSignature=REDACTED&key=REDACTED&page=2',
      );
    });

    specify('should mask userinfo up to the last @ before the host', function () {
      const redactor = new HTTPRedactor();

      assert.strictEqual(
        redactor.url('https://user:p@ss@api.example.com/x?a=1'),
        'https://REDACTED:REDACTED@api.example.com/x?a=1',
      );
      assert.strictEqual(
        redactor.url('//user:pass@api.example.com/x'),
        '//REDACTED:REDACTED@api.example.com/x',
      );
    });

    specify('should match query names case-insensitively', function () {
      assert.strictEqual(
        new HTTPRedactor().url('https://api.example.com/f?signature=a&SIG=b&Key=c', ['key']),
        'https://api.example.com/f?signature=REDACTED&SIG=REDACTED&Key=REDACTED',
      );
    });

    specify('should leave a URL without credentials unchanged', function () {
      const url = 'https://api.example.com/pets?status=available';

      assert.strictEqual(new HTTPRedactor().url(url), url);
    });
  });
});
