import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';

import { assert } from 'chai';
import HTTPResolverAxios from '@speclynx/apidom-reference/resolve/resolvers/http-axios';

import {
  ArazzoRunner,
  DocumentRegistry,
  ArazzoDocumentRegistryProvider,
  OpenAPIDocumentRegistryProvider,
  ClientError,
  DocumentLoadError,
  NormalizationError,
  type HTTPClient,
  type OpenAPIOperationRequest,
} from '../src/index.ts';

const token = 'document-retrieval-secret';

/**
 * The documents a test server serves. The workflow inputs and an operation
 * parameter are external references, which only the normalizers fetch.
 */
const documentsFor = (baseURL: string): Record<string, unknown> => ({
  '/arazzo.json': {
    arazzo: '1.0.1',
    info: { title: 'Document retrieval', version: '1.0.0' },
    sourceDescriptions: [{ name: 'pets', url: './openapi.json', type: 'openapi' }],
    workflows: [
      {
        workflowId: 'getPet',
        inputs: { $ref: './inputs.json' },
        steps: [
          {
            stepId: 'getPet',
            operationId: 'getPet',
            parameters: [{ name: 'id', in: 'query', value: '$inputs.id' }],
            successCriteria: [{ condition: '$statusCode == 200' }],
          },
        ],
      },
    ],
  },
  '/inputs.json': { type: 'object', properties: { id: { type: 'string' } } },
  '/openapi.json': {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    servers: [{ url: baseURL }],
    paths: {
      '/pets': {
        get: {
          operationId: 'getPet',
          parameters: [{ $ref: './shared.json#/components/parameters/id' }],
          responses: { 200: { description: 'OK' } },
        },
      },
    },
  },
  '/shared.json': {
    openapi: '3.1.0',
    info: { title: 'Shared', version: '1.0.0' },
    paths: {},
    components: {
      parameters: { id: { name: 'id', in: 'query', schema: { type: 'string' } } },
    },
  },
});

interface TestServer {
  readonly server: http.Server;
  readonly baseURL: string;
  /**
   * The path of every document request, with whether it carried the token.
   */
  readonly requests: { path: string; authorized: boolean }[];
}

/**
 * Starts a server for the documents and for the `/pets` API operation. With
 * `protect`, documents are served only to requests carrying the token.
 */
const startServer = (
  createServer: (listener: http.RequestListener) => http.Server,
  protocol: 'http' | 'https',
  protect: boolean,
): Promise<TestServer> =>
  new Promise((resolve) => {
    const requests: TestServer['requests'] = [];
    let baseURL = '';
    const server = createServer((request, response) => {
      const requestPath = request.url!.split('?')[0];

      response.setHeader('content-type', 'application/json');
      if (requestPath === '/pets') {
        response.end(JSON.stringify({ id: 7, name: 'Rex' }));
        return;
      }

      const authorized = request.headers.authorization === `Bearer ${token}`;
      const document = documentsFor(baseURL)[requestPath];
      requests.push({ path: requestPath, authorized });

      if (protect && !authorized) response.statusCode = 401;
      else if (document === undefined) response.statusCode = 404;
      response.end(JSON.stringify(response.statusCode === 200 ? document : {}));
    });

    server.listen(0, () => {
      baseURL = `${protocol}://localhost:${(server.address() as AddressInfo).port}`;
      resolve({ server, baseURL, requests });
    });
  });

const stopServer = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
  });

/**
 * A stub transport answering every API call with the same pet, recording the
 * sent requests into `calls`.
 */
const makeHTTPClient = (calls: OpenAPIOperationRequest[]): HTTPClient => {
  return async (request) => {
    calls.push(request);
    return new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
};

/**
 * Runs a promise expected to reject and returns what it rejected with.
 */
const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

const credentials = {
  resolverOpts: { axiosConfig: { headers: { Authorization: `Bearer ${token}` } } },
};

describe('ArazzoRunner document retrieval', function () {
  context('given documents behind credentials', function () {
    let testServer: TestServer;
    let entryURL: string;

    beforeEach(async function () {
      testServer = await startServer(http.createServer, 'http', true);
      entryURL = `${testServer.baseURL}/arazzo.json`;
    });

    afterEach(async function () {
      await stopServer(testServer.server);
    });

    specify('should fail to load without the resolve option', async function () {
      const error = await captureRejection(ArazzoRunner.load(entryURL));

      assert.instanceOf(error, DocumentLoadError);
    });

    specify('should retrieve every document with the resolve option', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const runner = await ArazzoRunner.load(entryURL, {
        resolve: credentials,
        httpClient: makeHTTPClient(calls),
      });

      const result = await runner.execute('getPet', { inputs: { id: '7' } });

      assert.strictEqual(result.status, 'completed');
      assert.sameMembers(
        testServer.requests.map((request) => request.path),
        ['/arazzo.json', '/openapi.json', '/inputs.json', '/shared.json'],
      );
      assert.isTrue(testServer.requests.every((request) => request.authorized));
    });

    specify('should not send the resolve credentials with API calls', async function () {
      const calls: OpenAPIOperationRequest[] = [];
      const runner = await ArazzoRunner.load(entryURL, {
        resolve: credentials,
        httpClient: makeHTTPClient(calls),
      });

      await runner.execute('getPet', { inputs: { id: '7' } });

      assert.lengthOf(calls, 1);
      assert.notInclude(inspect(calls[0], { depth: Infinity }), token);
    });

    specify('should not apply the request interceptor to document retrieval', async function () {
      const runner = await ArazzoRunner.load(entryURL, {
        resolve: credentials,
        httpClient: makeHTTPClient([]),
        requestInterceptor: (request) => {
          request.headers['X-API-Call'] = 'yes';
        },
      });
      const headersSeen: http.IncomingHttpHeaders[] = [];
      testServer.server.on('request', (request) => headersSeen.push(request.headers));

      await runner.execute('getPet', { inputs: { id: '7' } });

      assert.isNotEmpty(headersSeen);
      assert.isTrue(headersSeen.every((headers) => headers['x-api-call'] === undefined));
    });

    context('given registry built with the same options', function () {
      specify('should reach the normalizers through the resolve option', async function () {
        const registry = new DocumentRegistry({
          providers: [
            new ArazzoDocumentRegistryProvider({ resolve: credentials }),
            new OpenAPIDocumentRegistryProvider({ resolve: credentials }),
          ],
        });
        const runner = await ArazzoRunner.load(entryURL, {
          registry,
          resolve: credentials,
          httpClient: makeHTTPClient([]),
        });

        const result = await runner.execute('getPet', { inputs: { id: '7' } });

        assert.strictEqual(result.status, 'completed');
        assert.isTrue(testServer.requests.every((request) => request.authorized));
      });

      specify('should fail on external references without the resolve option', async function () {
        const registry = new DocumentRegistry({
          providers: [
            new ArazzoDocumentRegistryProvider({ resolve: credentials }),
            new OpenAPIDocumentRegistryProvider({ resolve: credentials }),
          ],
        });
        const runner = await ArazzoRunner.load(entryURL, {
          registry,
          httpClient: makeHTTPClient([]),
        });

        const error = await captureRejection(runner.execute('getPet', { inputs: { id: '7' } }));

        assert.instanceOf(error, NormalizationError);
      });
    });

    context('given HTTP resolver of its own', function () {
      specify('should not be served documents cached by other runners', async function () {
        await ArazzoRunner.load(entryURL, { resolve: credentials });
        const requestCount = testServer.requests.length;

        const error = await captureRejection(
          ArazzoRunner.load(entryURL, { resolve: { resolvers: [new HTTPResolverAxios()] } }),
        );

        assert.instanceOf(error, DocumentLoadError);
        assert.isAbove(testServer.requests.length, requestCount);
      });
    });

    context('given document that cannot be retrieved', function () {
      specify('should not expose the credentials in the error', async function () {
        const error = await captureRejection(
          ArazzoRunner.load(`${testServer.baseURL}/missing.json`, { resolve: credentials }),
        );

        assert.instanceOf(error, DocumentLoadError);
        assert.notInclude(inspect(error, { depth: Infinity }), token);
      });
    });
  });

  context('given server requiring a client certificate', function () {
    let directory: string;
    let tls: { ca: Buffer; cert: Buffer; key: Buffer };
    let testServer: TestServer;
    let entryURL: string;

    /**
     * An HTTP client presenting the client certificate, built on `node:https`.
     */
    const makeMutualTLSClient = (): HTTPClient => {
      const agent = new https.Agent(tls);

      return (request) =>
        new Promise((resolve, reject) => {
          https
            .request(request.url, { method: request.method, agent }, (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (chunk: Buffer) => chunks.push(chunk));
              response.on('end', () => {
                resolve(
                  new Response(Buffer.concat(chunks), {
                    status: response.statusCode,
                    headers: { 'content-type': response.headers['content-type']! },
                  }),
                );
              });
            })
            .on('error', reject)
            .end();
        });
    };

    before(function () {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'usearazzo-runner-mtls-'));
      const file = (name: string) => path.join(directory, name);
      const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });

      try {
        openssl('version');
      } catch {
        this.skip();
      }

      fs.writeFileSync(file('san.cnf'), 'subjectAltName=DNS:localhost');
      openssl(
        ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=test-ca'],
        ...['-keyout', file('ca.key'), '-out', file('ca.crt')],
      );
      for (const name of ['server', 'client']) {
        openssl(
          ...['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost'],
          ...['-keyout', file(`${name}.key`), '-out', file(`${name}.csr`)],
        );
        openssl(
          ...['x509', '-req', '-days', '2', '-CAcreateserial', '-extfile', file('san.cnf')],
          ...['-in', file(`${name}.csr`), '-CA', file('ca.crt'), '-CAkey', file('ca.key')],
          ...['-out', file(`${name}.crt`)],
        );
      }

      tls = {
        ca: fs.readFileSync(file('ca.crt')),
        cert: fs.readFileSync(file('client.crt')),
        key: fs.readFileSync(file('client.key')),
      };
    });

    after(function () {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    beforeEach(async function () {
      const file = (name: string) => fs.readFileSync(path.join(directory, name));

      testServer = await startServer(
        (listener) =>
          https.createServer(
            {
              ca: tls.ca,
              cert: file('server.crt'),
              key: file('server.key'),
              requestCert: true,
              rejectUnauthorized: true,
            },
            listener,
          ),
        'https',
        false,
      );
      entryURL = `${testServer.baseURL}/arazzo.json`;
    });

    afterEach(async function () {
      await stopServer(testServer.server);
    });

    specify('should fail to load without a client certificate', async function () {
      const error = await captureRejection(ArazzoRunner.load(entryURL));

      assert.instanceOf(error, DocumentLoadError);
    });

    specify('should retrieve documents and call the API with one', async function () {
      const runner = await ArazzoRunner.load(entryURL, {
        resolve: { resolverOpts: { axiosConfig: { httpsAgent: new https.Agent(tls) } } },
        httpClient: makeMutualTLSClient(),
      });

      const result = await runner.execute('getPet', { inputs: { id: '7' } });

      assert.strictEqual(result.status, 'completed');
      assert.sameMembers(
        testServer.requests.map((request) => request.path),
        ['/arazzo.json', '/openapi.json', '/inputs.json', '/shared.json'],
      );
    });

    specify('should need the client certificate for API calls too', async function () {
      const runner = await ArazzoRunner.load(entryURL, {
        resolve: { resolverOpts: { axiosConfig: { httpsAgent: new https.Agent(tls) } } },
      });

      const error = await captureRejection(runner.execute('getPet', { inputs: { id: '7' } }));

      assert.instanceOf(error, ClientError);
    });
  });
});
