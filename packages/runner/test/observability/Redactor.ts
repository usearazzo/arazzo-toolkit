import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  Redactor,
  type ArazzoRunnerEvent,
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
): OpenAPIOperationRequestStartEvent => ({
  type: 'openapi-operation-request-start',
  timestamp: 1,
  ...operation,
  request: { method: 'GET', url: 'https://api.example.com/x', headers: {}, ...request },
});

const settled = (
  response: Partial<OpenAPIOperationRequestSettledEvent['response']>,
): OpenAPIOperationRequestSettledEvent => ({
  type: 'openapi-operation-request-settled',
  timestamp: 2,
  ...operation,
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

    specify('should replace the default patterns', function () {
      const { headers } = new Redactor({ fields: ['x-tenant'] }).event(
        start({ headers: { Authorization: 'a', 'X-Tenant': 't' } }),
      ).request;

      assert.deepEqual(headers, { Authorization: 'a', 'X-Tenant': 'REDACTED' });
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
    const urlOf = (url: string): string => new Redactor().event(start({ url })).request.url;

    specify('should mask userinfo, split at the last @ as URL parsers do', function () {
      assert.strictEqual(
        urlOf('https://user:p@ss@api.example.com/x'),
        'https://REDACTED:REDACTED@api.example.com/x',
      );
    });

    specify('should mask matching query values, case-insensitively', function () {
      assert.strictEqual(
        urlOf('https://api.example.com/f?a=1&SIGNATURE=x&sig=1&sig=2&key=k#frag?sig=keep'),
        'https://api.example.com/f?a=1&SIGNATURE=REDACTED&sig=REDACTED&sig=REDACTED&key=REDACTED#frag?sig=keep',
      );
    });

    specify('should leave a URL with nothing to mask exactly as it was', function () {
      const url = 'HTTPS://api.example.com:443/f?a=%20b+c&flag';

      assert.strictEqual(urlOf(url), url);
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

    specify('should mask JSON fields at any depth, as text or as a parsed value', function () {
      const text = new Redactor().event(
        start({ headers: json, body: '{"user":{"name":"a","password":"p"},"tokens":[1]}' }),
      ).request.body;
      const value = new Redactor().event(
        settled({ headers: json, body: { user: { password: 'p' }, id: 7 } }),
      ).response.body;

      assert.deepEqual(JSON.parse(text as string), {
        user: { name: 'a', password: 'REDACTED' },
        tokens: 'REDACTED',
      });
      assert.deepEqual(value, { user: { password: 'REDACTED' }, id: 7 });
    });

    specify('should mask URL-encoded form fields', function () {
      const { body } = new Redactor().event(
        start({
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=password&password=p&client_secret=s',
        }),
      ).request;

      assert.strictEqual(body, 'grant_type=password&password=REDACTED&client_secret=REDACTED');
    });

    specify('should mask whole a body it cannot mask field by field', function () {
      const redactor = new Redactor();

      assert.strictEqual(
        redactor.event(
          settled({ headers: { 'content-type': 'application/xml' }, body: '<a>s</a>' }),
        ).response.body,
        'REDACTED',
      );
      assert.strictEqual(
        redactor.event(settled({ headers: json, body: '{not json' })).response.body,
        'REDACTED',
      );
      assert.strictEqual(redactor.event(start({ body: new Blob(['x']) })).request.body, 'REDACTED');
    });

    specify('should cut a long body', function () {
      const { body } = new Redactor().event(
        settled({ headers: json, body: { data: 'x'.repeat(Redactor.BODY_LIMIT) } }),
      ).response;

      assert.lengthOf(body as string, Redactor.BODY_LIMIT + 1);
      assert.isTrue((body as string).endsWith('…'));
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

  specify('should leave every field of a run without credentials as it was', async function () {
    // a generic walk masks any matching name; no event's own field may match.
    const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
    const events: ArazzoRunnerEvent[] = [];
    const runner = await ArazzoRunner.load(
      path.join(fixtures, 'workflow-control-flow.arazzo.yaml'),
      {
        httpClient: async () =>
          new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        captureBodies: true,
        observer: (event) => events.push(event),
      },
    );

    await runner.execute('retryWithWorkflowReference', { inputs: { status: 'available' } });
    await runner.execute('linear', { inputs: { status: 'available' } });

    const redactor = new Redactor();
    assert.isAbove(new Set(events.map((event) => event.type)).size, 15);
    for (const event of events) assert.deepEqual(redactor.event(event), event, event.type);
  });

  specify('should keep its defaults frozen', function () {
    assert.isTrue(Object.isFrozen(Redactor.defaultFields));
  });
});
