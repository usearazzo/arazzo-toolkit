import { assert } from 'chai';

import {
  Redactor,
  type CriterionEvaluatedEvent,
  type DocumentLoadStartEvent,
  type OpenAPIOperationRequestSettledEvent,
  type OpenAPIOperationRequestStartEvent,
  type StepStartEvent,
  type WorkflowSettledEvent,
} from '../../src/index.ts';

const frame = { runId: 'run-1', workflowId: 'w', path: ['w'], timestamp: 1 };
const operation = {
  operation: { documentURI: 'https://api.example.com/openapi.json', jsonPointer: '/paths' },
};

const start = (
  request: Partial<OpenAPIOperationRequestStartEvent['request']>,
  credentials: string[] = [],
): OpenAPIOperationRequestStartEvent => ({
  type: 'openapi-operation-request-start',
  timestamp: 1,
  ...operation,
  credentials,
  request: { method: 'GET', url: 'https://api.example.com/x', headers: {}, ...request },
});

const settled = (
  response: Partial<OpenAPIOperationRequestSettledEvent['response']>,
): OpenAPIOperationRequestSettledEvent => ({
  type: 'openapi-operation-request-settled',
  timestamp: 2,
  ...operation,
  credentials: [],
  response: { status: 200, headers: {}, ...response },
});

describe('Redactor', function () {
  context('headers', function () {
    specify('should mask the default credential names, whatever their case', function () {
      const { headers } = new Redactor().event(
        start({
          headers: {
            Authorization: 'Bearer secret',
            'Proxy-Authorization': 'Basic x',
            Cookie: 'session=1',
            'X-Api-Key': 'k',
            'X-Auth-Token': 't',
            Accept: 'application/json',
          },
        }),
      ).request;

      assert.deepEqual(headers, {
        Authorization: 'REDACTED',
        'Proxy-Authorization': 'REDACTED',
        Cookie: 'REDACTED',
        'X-Api-Key': 'REDACTED',
        'X-Auth-Token': 'REDACTED',
        Accept: 'application/json',
      });
    });

    specify('should replace the defaults, and still mask the listed credentials', function () {
      const { headers } = new Redactor({ fields: ['x-tenant'] }).event(
        start({ headers: { Authorization: 'a', 'X-Tenant': 't', api_key: 'k' } }, ['api_key']),
      ).request;

      assert.deepEqual(headers, {
        Authorization: 'a',
        'X-Tenant': 'REDACTED',
        api_key: 'REDACTED',
      });
    });

    specify('should mask the URL a Location header carries', function () {
      const { headers } = new Redactor().event(
        settled({ headers: { location: 'https://u:p@api.example.com/x?Signature=s&page=2' } }),
      ).response;

      assert.strictEqual(
        headers.location,
        'https://REDACTED:REDACTED@api.example.com/x?Signature=REDACTED&page=2',
      );
    });
  });

  context('urls', function () {
    const urlOf = (url: string, credentials: string[] = []): string =>
      new Redactor().event(start({ url }, credentials)).request.url;

    specify('should mask userinfo up to the last @ before the host', function () {
      assert.strictEqual(
        urlOf('https://user:p@ss@api.example.com/x'),
        'https://REDACTED:REDACTED@api.example.com/x',
      );
      assert.strictEqual(
        urlOf('//user:pass@api.example.com/x'),
        '//REDACTED:REDACTED@api.example.com/x',
      );
    });

    specify('should mask matching query values and leave the rest as sent', function () {
      assert.strictEqual(
        urlOf(
          'https://api.example.com/f?a=%20b+c&SIGNATURE=x&sig=1&sig=2&flag&key=k#frag?sig=keep',
          ['key'],
        ),
        'https://api.example.com/f?a=%20b+c&SIGNATURE=REDACTED&sig=REDACTED&sig=REDACTED&flag&key=REDACTED#frag?sig=keep',
      );
    });

    specify('should mask userinfo in document URIs and paths', function () {
      const event: DocumentLoadStartEvent = {
        type: 'document-load-start',
        timestamp: 1,
        uri: 'https://u:p@docs.example.com/flow.arazzo.yaml',
      };
      const step: StepStartEvent = {
        type: 'step-start',
        ...frame,
        path: ['w', 'https://u:p@docs.example.com/child.arazzo.yaml#child'],
        stepId: 's',
      };

      assert.strictEqual(
        new Redactor().event(event).uri,
        'https://REDACTED:REDACTED@docs.example.com/flow.arazzo.yaml',
      );
      assert.deepEqual(new Redactor().event(step).path, [
        'w',
        'https://REDACTED:REDACTED@docs.example.com/child.arazzo.yaml#child',
      ]);
    });
  });

  context('bodies', function () {
    const json = { 'content-type': 'application/json' };

    specify('should mask JSON fields at any depth', function () {
      const { body } = new Redactor().event(
        start({
          headers: json,
          body: { text: '{"user":{"name":"a","password":"p"},"tokens":[1]}', size: 1 },
        }),
      ).request;

      assert.deepEqual(JSON.parse(body?.text ?? ''), {
        user: { name: 'a', password: 'REDACTED' },
        tokens: 'REDACTED',
      });
      assert.strictEqual(body?.size, 1);
    });

    specify('should mask URL-encoded form fields', function () {
      const { body } = new Redactor().event(
        start({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: { text: 'grant_type=password&password=p&client_secret=s' },
        }),
      ).request;

      assert.strictEqual(
        body?.text,
        'grant_type=password&password=REDACTED&client_secret=REDACTED',
      );
    });

    specify('should keep only the size of a body it cannot mask', function () {
      const xml = new Redactor().event(
        settled({
          headers: { 'content-type': 'application/xml' },
          body: { text: '<a>secret</a>', size: 13 },
        }),
      ).response.body;
      const broken = new Redactor().event(
        settled({ headers: json, body: { text: '{not json', size: 9 } }),
      ).response.body;

      assert.deepEqual(xml, { size: 13 });
      assert.deepEqual(broken, { size: 9 });
    });

    specify('should cut a long body and say so', function () {
      const text = JSON.stringify({ data: 'x'.repeat(Redactor.BODY_LIMIT) });

      const { body } = new Redactor().event(settled({ headers: json, body: { text } })).response;

      assert.lengthOf(body?.text ?? '', Redactor.BODY_LIMIT);
      assert.isTrue(body?.truncated);
    });
  });

  context('workflow data', function () {
    specify('should mask outputs by field name, keeping own __proto__ keys as data', function () {
      const event: WorkflowSettledEvent = {
        type: 'workflow-settled',
        ...frame,
        status: 'completed',
        settledStatus: 'completed',
        outputs: JSON.parse('{"sessionToken":"t","pet":{"name":"Rex"},"__proto__":{"x":1}}'),
      };

      const { outputs } = new Redactor().event(event);

      assert.deepEqual(Object.keys(outputs), ['sessionToken', 'pet', '__proto__']);
      assert.strictEqual(outputs.sessionToken, 'REDACTED');
      assert.deepEqual(outputs.pet, { name: 'Rex' });
    });

    specify('should mask criterion values by the name each expression reads', function () {
      const event: CriterionEvaluatedEvent = {
        type: 'criterion-evaluated',
        ...frame,
        stepId: 's',
        attempt: 1,
        kind: 'success',
        criterion: {
          condition: 'c',
          met: false,
          values: {
            $statusCode: 404,
            '$inputs.password': 'p',
            '$request.header.Authorization': 'Bearer t',
            '$response.body#/access_token': 't',
            '$response.body': { id: 7, secret: 's' },
            $url: 'https://u:p@api.example.com/x',
          },
        },
      };

      assert.deepEqual(new Redactor().event(event).criterion.values, {
        $statusCode: 404,
        '$inputs.password': 'REDACTED',
        '$request.header.Authorization': 'REDACTED',
        '$response.body#/access_token': 'REDACTED',
        '$response.body': { id: 7, secret: 'REDACTED' },
        $url: 'https://REDACTED:REDACTED@api.example.com/x',
      });
    });
  });

  specify('should keep its defaults frozen', function () {
    assert.isTrue(Object.isFrozen(Redactor.defaultFields));
  });
});
