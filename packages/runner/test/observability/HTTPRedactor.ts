import { assert } from 'chai';

import HTTPRedactor from '../../src/observability/HTTPRedactor.ts';

describe('HTTPRedactor', function () {
  context('headers', function () {
    specify('should mask the default credential headers, whatever their case', function () {
      const headers = new HTTPRedactor().headers(
        Object.entries({
          Authorization: 'Bearer secret',
          cookie: 'session=1',
          'Set-Cookie': 'session=2',
          'Proxy-Authorization': 'Basic x',
          Accept: 'application/json',
        }),
      );

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
        Object.entries({ Authorization: 'Bearer secret', 'X-Session': 's', api_key: 'k' }),
        ['api_key'],
      );

      assert.deepEqual(headers, {
        Authorization: 'Bearer secret',
        'X-Session': 'REDACTED',
        api_key: 'REDACTED',
      });
    });
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

    specify('should leave a URL without credentials unchanged', function () {
      const url = 'https://api.example.com/pets?status=available';

      assert.strictEqual(new HTTPRedactor().url(url), url);
    });
  });
});
