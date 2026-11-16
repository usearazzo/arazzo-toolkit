import { assert } from 'chai';
import { StepParametersElement, refractParameter } from '@speclynx/apidom-ns-arazzo-1';

import {
  OpenAPIOperationParameterResolver,
  ResolverError,
  RuntimeExpressionEvaluator,
  type RuntimeExpressionResolver,
} from '../../src/index.ts';

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

describe('OpenAPIOperationParameterResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    { inputs: { status: 'available' }, steps: { login: { outputs: { token: 'abc' } } } },
    { strict: false },
  );
  const resolve: RuntimeExpressionResolver = (expression) => runtime.evaluate(expression);
  const scope = { stepId: 'step1' };
  let resolver: OpenAPIOperationParameterResolver;

  beforeEach(function () {
    resolver = new OpenAPIOperationParameterResolver();
  });

  const parameters = (
    ...entries: { name: string; in?: string; value: unknown }[]
  ): StepParametersElement =>
    new StepParametersElement(entries.map((entry) => refractParameter(entry)));

  context('resolve', function () {
    specify('should let parameters differing only in their location coexist', async function () {
      // a parameter is unique by (name, in), so an operation may declare
      // `token` both as a header and as a query parameter — keying by bare
      // name would collapse them and silently drop one.
      const result = await resolver.resolve(
        parameters(
          { name: 'token', in: 'header', value: '$steps.login.outputs.token' },
          { name: 'token', in: 'query', value: 'legacy' },
        ),
        resolve,
        scope,
      );

      assert.deepEqual(result, { 'header.token': 'abc', 'query.token': 'legacy' });
    });

    specify('should return an empty object when parameters are absent', async function () {
      assert.deepEqual(await resolver.resolve(undefined, resolve, scope), {});
    });

    specify('should let the earlier of two same-(name, in) parameters win', async function () {
      // the delivery key is exactly the (name, in) identity the normalizer
      // merges on, so only a genuinely same parameter can shadow another — and
      // the list leads with the most specific, the step's own.
      const result = await resolver.resolve(
        parameters(
          { name: 'trace', in: 'query', value: 'from-step' },
          { name: 'trace', in: 'query', value: 'from-workflow' },
        ),
        resolve,
        scope,
      );

      assert.deepEqual(result, { 'query.trace': 'from-step' });
    });

    specify('should carry a dotted parameter name into the qualified key', async function () {
      // a query parameter genuinely named `filter.name` — the client looks the
      // key up verbatim (it builds '{in}.{name}' from the declared parameter
      // rather than splitting the key), and the ambiguity guard below rejects
      // the rare collision the dots make possible.
      const result = await resolver.resolve(
        parameters({ name: 'filter.name', in: 'query', value: 'rex' }),
        resolve,
        scope,
      );

      assert.deepEqual(result, { 'query.filter.name': 'rex' });
    });

    specify('should keep the bare name for the querystring location', async function () {
      // legal in Arazzo, but no OpenAPI location — there is nothing to qualify
      // against, and the bare name can still reach a same-named declared
      // parameter, as it did before delivery was qualified.
      const result = await resolver.resolve(
        parameters({ name: 'filter', in: 'querystring', value: 'x' }),
        resolve,
        scope,
      );

      assert.deepEqual(result, { filter: 'x' });
    });

    specify('should throw ResolverError for a parameter without a location', async function () {
      // a step targeting an operation requires `in`; delivering the value bare
      // instead would let it capture every declared location of that name,
      // since the client consults bare names before qualified ones.
      const error = await captureRejection(
        resolver.resolve(parameters({ name: 'token', value: 'wf' }), resolve, scope),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /declares no location/);
    });

    specify('should throw ResolverError for a non-string location', async function () {
      const error = await captureRejection(
        resolver.resolve(
          parameters({ name: 'x', in: 1 as unknown as string, value: 'v' }),
          resolve,
          scope,
        ),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /non-string location/);
    });

    specify('should throw invalid-location for an in: body parameter', async function () {
      // Arazzo 1.0.1 removed `body` from the Parameter Object's locations; a
      // payload travels as the step's `requestBody`.
      const error = await captureRejection(
        resolver.resolve(parameters({ name: 'pet', in: 'body', value: { id: 7 } }), resolve, scope),
      );

      assert.instanceOf(error, ResolverError);
      assert.strictEqual(error.reason, 'invalid-location');
      assert.strictEqual(error.target, 'pet');
      assert.match(error.message, /Parameter "pet" has location "body"/);
    });

    specify('should throw invalid-location for an unknown location', async function () {
      const error = await captureRejection(
        resolver.resolve(parameters({ name: 'x', in: 'headers', value: 'v' }), resolve, scope),
      );

      assert.instanceOf(error, ResolverError);
      assert.strictEqual(error.reason, 'invalid-location');
      assert.strictEqual(error.target, 'x');
      assert.match(
        error.message,
        /has location "headers", which is not one of path, query, header, cookie, querystring/,
      );
    });

    specify('should not throw invalid-location for any defined location', async function () {
      const result = await resolver.resolve(
        parameters(
          { name: 'id', in: 'path', value: 1 },
          { name: 'q', in: 'query', value: 2 },
          { name: 'h', in: 'header', value: 3 },
          { name: 'c', in: 'cookie', value: 4 },
          { name: 'qs', in: 'querystring', value: 5 },
        ),
        resolve,
        scope,
      );

      assert.deepEqual(result, {
        'path.id': 1,
        'query.q': 2,
        'header.h': 3,
        'cookie.c': 4,
        qs: 5,
      });
    });

    specify('should throw when a querystring parameter shadows a qualified one', async function () {
      // the two produce different keys ('token' and 'header.token'), so this
      // is not a key collision — but the client consults the bare name first
      // for every declared parameter bearing it, so the querystring entry
      // would silently capture the header's value.
      const error = await captureRejection(
        resolver.resolve(
          parameters(
            { name: 'token', in: 'querystring', value: 'qs' },
            { name: 'token', in: 'header', value: 'secret' },
          ),
          resolve,
          scope,
        ),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /cannot be delivered unambiguously/);
    });

    specify('should throw for the shadowing pair in either order', async function () {
      const error = await captureRejection(
        resolver.resolve(
          parameters(
            { name: 'token', in: 'header', value: 'secret' },
            { name: 'token', in: 'querystring', value: 'qs' },
          ),
          resolve,
          scope,
        ),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /cannot be delivered unambiguously/);
    });

    specify('should throw ResolverError for a missing or non-string name', async function () {
      // as loud as a malformed location: a silently dropped parameter would
      // surface only as a downstream request failure with nothing pointing at
      // the cause.
      const error = await captureRejection(
        resolver.resolve(
          parameters({ name: 1 as unknown as string, in: 'query', value: 'v' }),
          resolve,
          scope,
        ),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /missing or non-string name/);
    });

    specify('should store a bare parameter named __proto__ as an own property', async function () {
      // bracket assignment would hit the __proto__ accessor and never create
      // an own property — silently losing the parameter, whatever its value.
      const result = await resolver.resolve(
        parameters({ name: '__proto__', in: 'querystring', value: 'x' }),
        resolve,
        scope,
      );

      assert.isTrue(Object.hasOwn(result, '__proto__'));
      assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
    });

    specify('should throw ResolverError for two parameters producing one key', async function () {
      // the '{in}.{name}' scheme is the client's and is not injective: a
      // querystring parameter named `query.id` and a query parameter named
      // `id` both produce the key `query.id`. The querystring one is
      // misaddressed on its own, so it is rejected whichever claims first.
      const entries = [
        { name: 'query.id', in: 'querystring', value: 'a' },
        { name: 'id', in: 'query', value: 'b' },
      ];
      for (const ordered of [entries, [...entries].reverse()]) {
        const error = await captureRejection(
          resolver.resolve(parameters(...ordered), resolve, scope),
        );

        assert.instanceOf(error, ResolverError);
        assert.match(error.message, /reads as the delivery key of another location/);
        assert.strictEqual(error.target, 'query.id');
      }
    });

    specify(
      'should throw for a lone querystring parameter named like a location prefix',
      async function () {
        // the client matches the bare key `header.X-Foo` as the qualified key of
        // a declared header `X-Foo`, so the value would be sent as that header.
        for (const name of [
          'header.X-Foo',
          'query.id',
          'cookie.c',
          'path.id',
          'formData.f',
          'body.b',
        ]) {
          const error = await captureRejection(
            resolver.resolve(parameters({ name, in: 'querystring', value: 'q=1' }), resolve, scope),
          );

          assert.instanceOf(error, ResolverError);
          assert.match(error.message, /cannot be delivered unambiguously/);
          assert.strictEqual(error.reason, 'ambiguous-delivery');
          assert.strictEqual(error.target, name);
        }
      },
    );

    specify('should keep a querystring name whose prefix is not a location', async function () {
      const result = await resolver.resolve(
        parameters(
          { name: 'filter.name', in: 'querystring', value: 'a' },
          { name: 'headers', in: 'querystring', value: 'b' },
          { name: 'Header.X', in: 'querystring', value: 'c' },
        ),
        resolve,
        scope,
      );

      assert.deepEqual(result, { 'filter.name': 'a', headers: 'b', 'Header.X': 'c' });
    });

    specify('should throw ResolverError for a present but non-list parameters', async function () {
      // walking it would fail as a bare `TypeError: parameters is not iterable`
      // — raised by the language, naming an internal variable, and carrying
      // nothing a caller can branch on.
      const error = await captureRejection(resolver.resolve('not-a-list' as never, resolve, scope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /is present but is not a list/);
      assert.strictEqual(error.reason, 'malformed-parameters');
      assert.strictEqual(error.target, 'parameters');
      assert.strictEqual(error.stepId, scope.stepId);
    });
  });
});
