import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  ExecutionError,
  type HTTPClient,
  type OpenAPIOperationRequest,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'execute-options.arazzo.yaml');

/**
 * Loads the fixture with a stub transport recording the sent requests.
 *
 * `petsAPI` and `paymentsAPI` both declare a security scheme named `api_key`:
 * a header for the first, a query parameter for the second.
 */
const makeRunner = async (): Promise<{
  runner: ArazzoRunner;
  calls: OpenAPIOperationRequest[];
}> => {
  const calls: OpenAPIOperationRequest[] = [];
  const httpClient: HTTPClient = async (request) => {
    calls.push(request);
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return { runner: await ArazzoRunner.load(entryPath, { httpClient }), calls };
};

/**
 * Runs a promise expected to reject with an ExecutionError and returns it.
 */
const captureError = async (promise: Promise<unknown>): Promise<ExecutionError> => {
  try {
    await promise;
  } catch (error) {
    assert.instanceOf(error, ExecutionError);
    return error as ExecutionError;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

describe('WorkflowExecutor — executeOptions per source description', function () {
  context('given entries for two APIs sharing a security scheme name', function () {
    const executeOptions = {
      petsAPI: {
        server: 'https://pets.override.example',
        securities: { authorized: { api_key: 'PETS-KEY', bearer: { value: 'PETS-TOKEN' } } },
      },
      paymentsAPI: {
        securities: { authorized: { api_key: { value: 'PAYMENTS-KEY' } } },
      },
    };

    specify('should give each API its own credentials only', async function () {
      const { runner, calls } = await makeRunner();

      const result = await runner.execute('twoAPIs', { executeOptions });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls[0].headers['X-API-Key'], 'PETS-KEY');
      assert.strictEqual(calls[0].headers.Authorization, 'Bearer PETS-TOKEN');
      assert.include(calls[1].url, 'key=PAYMENTS-KEY');
      assert.notInclude(JSON.stringify(calls[1]), 'PETS-');
    });

    specify('should give each API its own server only', async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('twoAPIs', { executeOptions });

      assert.include(calls[0].url, 'https://pets.override.example/pets');
      assert.include(calls[1].url, 'https://payments.example/v2/charges');
    });

    specify('should apply no credentials to an operation requiring none', async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('twoAPIs', { executeOptions });

      assert.include(calls[2].url, 'https://pets.override.example/health');
      assert.isEmpty(calls[2].headers);
    });
  });

  context('given credential for each kind of security scheme', function () {
    // the vendored request builder applies these; the tests pin the forms the
    // `securities` option documents, one request per scheme.
    const executeOptions = {
      petsAPI: {
        securities: {
          authorized: {
            api_key: 'KEY',
            bearer: 'TOKEN',
            basic: { username: 'user', password: 'pass' },
            oauth: { token: { access_token: 'OAUTH' } },
            oidc: { token: { access_token: 'OIDC', token_type: 'DPoP' } },
            cookie_key: 'SESSION',
          },
        },
      },
      legacyAPI: {
        securities: {
          authorized: {
            api_key: { value: 'LEGACY-KEY' },
            basic: { username: 'user', password: 'pass' },
            oauth: { token: { access_token: 'LEGACY-OAUTH' } },
          },
        },
      },
    };
    let requests: Record<string, OpenAPIOperationRequest>;

    beforeEach(async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('credentialForms', { executeOptions });
      requests = Object.fromEntries(calls.map((call) => [call.url, call]));
    });

    specify('should send a bearer token given as a string', function () {
      assert.strictEqual(
        requests['https://pets.example/v1/pets'].headers.Authorization,
        'Bearer TOKEN',
      );
    });

    specify('should send basic credentials', function () {
      assert.strictEqual(
        requests['https://pets.example/v1/basic'].headers.Authorization,
        'Basic dXNlcjpwYXNz',
      );
    });

    specify('should send an oauth2 token as a bearer token', function () {
      assert.strictEqual(
        requests['https://pets.example/v1/oauth'].headers.Authorization,
        'Bearer OAUTH',
      );
    });

    specify('should send an openIdConnect token with its token type', function () {
      assert.strictEqual(
        requests['https://pets.example/v1/oidc'].headers.Authorization,
        'DPoP OIDC',
      );
    });

    specify('should send an API key declared in a cookie', function () {
      assert.strictEqual(
        requests['https://pets.example/v1/cookie'].headers.Cookie,
        'session=SESSION',
      );
    });

    context('given OpenAPI 2.0 document', function () {
      specify('should send an API key', function () {
        assert.strictEqual(
          requests['https://legacy.example/v1/key'].headers['X-API-Key'],
          'LEGACY-KEY',
        );
      });

      specify('should send basic credentials', function () {
        // the 2.0 request builder writes the header name in lower case
        assert.strictEqual(
          requests['https://legacy.example/v1/basic'].headers.authorization,
          'Basic dXNlcjpwYXNz',
        );
      });

      specify('should send an oauth2 token as a bearer token', function () {
        assert.strictEqual(
          requests['https://legacy.example/v1/oauth'].headers.authorization,
          'Bearer LEGACY-OAUTH',
        );
      });
    });
  });

  context('given entry for one API only', function () {
    specify('should give the other API no options', async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('twoAPIs', {
        executeOptions: {
          petsAPI: {
            server: 'https://pets.override.example',
            securities: { authorized: { api_key: 'PETS-KEY' } },
          },
        },
      });

      assert.strictEqual(calls[1].url, 'https://payments.example/v2/charges');
      assert.notInclude(JSON.stringify(calls[1]), 'PETS-KEY');
    });
  });

  context('given no executeOptions', function () {
    specify('should send every request as its document declares', async function () {
      const { runner, calls } = await makeRunner();

      const result = await runner.execute('twoAPIs');

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(calls[0].url, 'https://pets.example/v1/pets');
      assert.isEmpty(calls[0].headers);
    });
  });

  context('given steps of a nested Arazzo document', function () {
    const executeOptions = {
      petsAPI: { securities: { authorized: { api_key: 'PETS-KEY' } } },
    };

    specify('should reach the same OpenAPI document under another name', async function () {
      const { runner, calls } = await makeRunner();

      const result = await runner.execute('throughNested', { executeOptions });

      assert.strictEqual(result.status, 'completed');
      // the nested document knows the entry's `petsAPI` document as `animals`
      assert.strictEqual(calls[0].headers['X-API-Key'], 'PETS-KEY');
    });

    specify('should not reach another OpenAPI document under the same name', async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('throughNested', { executeOptions });

      // the nested document calls its payments document `petsAPI`
      assert.include(calls[1].url, 'https://payments.example/v2/charges');
      assert.notInclude(JSON.stringify(calls[1]), 'PETS-KEY');
    });
  });

  context('given entry that does not name one OpenAPI document', function () {
    specify('should throw for a name that is no source description', async function () {
      const { runner, calls } = await makeRunner();

      const error = await captureError(
        runner.execute('twoAPIs', {
          executeOptions: { petAPI: { server: 'https://typo.example' } },
        }),
      );

      assert.strictEqual(error.reason, ExecutionError.SourceDescriptionNotFound);
      assert.include(error.message, '"petAPI"');
      assert.isEmpty(calls);
    });

    specify('should throw for the options of a single API given without a name', async function () {
      const { runner, calls } = await makeRunner();
      // the shape `executeOptions` had before it was keyed by source description
      const executeOptions = { server: 'https://override.example' } as unknown as Record<
        string,
        Record<string, unknown>
      >;

      const error = await captureError(runner.execute('twoAPIs', { executeOptions }));

      assert.strictEqual(error.reason, ExecutionError.SourceDescriptionNotFound);
      assert.include(error.message, 'keyed by source description name');
      assert.isEmpty(calls);
    });

    specify('should throw for an entry that is not an object', async function () {
      const { runner } = await makeRunner();
      const executeOptions = { petsAPI: 'https://override.example' } as unknown as Record<
        string,
        Record<string, unknown>
      >;

      const error = await captureError(runner.execute('twoAPIs', { executeOptions }));

      assert.strictEqual(error.reason, ExecutionError.UnknownExecuteOption);
    });

    specify('should throw for executeOptions that are not an object', async function () {
      const { runner, calls } = await makeRunner();
      const executeOptions = [{ server: 'https://override.example' }] as unknown as Record<
        string,
        Record<string, unknown>
      >;

      const error = await captureError(runner.execute('twoAPIs', { executeOptions }));

      assert.strictEqual(error.reason, ExecutionError.UnknownExecuteOption);
      assert.isEmpty(calls);
    });

    specify('should throw for a source description without a url', async function () {
      const { runner, calls } = await makeRunner();

      const error = await captureError(
        runner.execute('twoAPIs', { executeOptions: { noURL: { server: 'https://x.example' } } }),
      );

      assert.strictEqual(error.reason, ExecutionError.SourceDescriptionNotFound);
      assert.include(error.message, 'has no url');
      assert.isEmpty(calls);
    });

    specify('should throw for a source description that is an Arazzo document', async function () {
      const { runner } = await makeRunner();

      const error = await captureError(
        runner.execute('twoAPIs', { executeOptions: { nested: { server: 'https://x.example' } } }),
      );

      assert.strictEqual(error.reason, ExecutionError.SourceDescriptionNotOpenAPI);
    });

    specify('should throw for two names pointing at the same document', async function () {
      const { runner, calls } = await makeRunner();

      const error = await captureError(
        runner.execute('twoAPIs', {
          executeOptions: {
            petsAPI: { server: 'https://one.example' },
            petsAPIAgain: { server: 'https://two.example' },
          },
        }),
      );

      assert.strictEqual(error.reason, ExecutionError.AmbiguousExecuteOptions);
      assert.include(error.message, '"petsAPI"');
      assert.include(error.message, '"petsAPIAgain"');
      assert.isEmpty(calls);
    });
  });

  context('given second name for a document that has one entry', function () {
    specify('should apply the entry whichever name a step uses', async function () {
      const { runner, calls } = await makeRunner();

      await runner.execute('twoAPIs', {
        executeOptions: { petsAPIAgain: { securities: { authorized: { api_key: 'PETS-KEY' } } } },
      });

      // the workflow's steps reference the document as `petsAPI`
      assert.strictEqual(calls[0].headers['X-API-Key'], 'PETS-KEY');
    });
  });
});
