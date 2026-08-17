import { assert } from 'chai';
import { StepParametersElement, refractParameter } from '@speclynx/apidom-ns-arazzo-1';

import {
  OpenAPIOperationParameterResolver,
  ResolverError,
  RuntimeExpressionEvaluator,
  type RuntimeExpressionResolver,
} from '../../src/index.ts';

describe('OpenAPIOperationParameterResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    { inputs: { status: 'available' }, steps: { login: { outputs: { token: 'abc' } } } },
    { strict: false },
  );
  const resolve: RuntimeExpressionResolver = (expression) => runtime.evaluate(expression);
  let resolver: OpenAPIOperationParameterResolver;

  beforeEach(function () {
    resolver = new OpenAPIOperationParameterResolver();
  });

  const parameters = (
    ...entries: { name: string; in?: string; value: unknown }[]
  ): StepParametersElement =>
    new StepParametersElement(entries.map((entry) => refractParameter(entry)));

  context('resolve', function () {
    specify('should let parameters differing only in their location coexist', function () {
      // a parameter is unique by (name, in), so an operation may declare
      // `token` both as a header and as a query parameter — keying by bare
      // name would collapse them and silently drop one.
      const result = resolver.resolve(
        parameters(
          { name: 'token', in: 'header', value: '$steps.login.outputs.token' },
          { name: 'token', in: 'query', value: 'legacy' },
        ),
        resolve,
      );

      assert.deepEqual(result, { 'header.token': 'abc', 'query.token': 'legacy' });
    });

    specify('should return an empty object when parameters are absent', function () {
      assert.deepEqual(resolver.resolve(undefined, resolve), {});
    });

    specify('should let the earlier of two same-(name, in) parameters win', function () {
      // the delivery key is exactly the (name, in) identity the normalizer
      // merges on, so only a genuinely same parameter can shadow another — and
      // the list leads with the most specific, the step's own.
      const result = resolver.resolve(
        parameters(
          { name: 'trace', in: 'query', value: 'from-step' },
          { name: 'trace', in: 'query', value: 'from-workflow' },
        ),
        resolve,
      );

      assert.deepEqual(result, { 'query.trace': 'from-step' });
    });

    specify('should carry a dotted parameter name into the qualified key', function () {
      // a query parameter genuinely named `filter.name` — the client looks the
      // key up verbatim (it builds '{in}.{name}' from the declared parameter
      // rather than splitting the key), and the ambiguity guard below rejects
      // the rare collision the dots make possible.
      const result = resolver.resolve(
        parameters({ name: 'filter.name', in: 'query', value: 'rex' }),
        resolve,
      );

      assert.deepEqual(result, { 'query.filter.name': 'rex' });
    });

    specify('should keep the bare name for the querystring location', function () {
      // legal in Arazzo, but no OpenAPI location — there is nothing to qualify
      // against, and the bare name can still reach a same-named declared
      // parameter, as it did before delivery was qualified.
      const result = resolver.resolve(
        parameters({ name: 'filter', in: 'querystring', value: 'x' }),
        resolve,
      );

      assert.deepEqual(result, { filter: 'x' });
    });

    specify('should throw ResolverError for a parameter without a location', function () {
      // a step targeting an operation requires `in`; delivering the value bare
      // instead would let it capture every declared location of that name,
      // since the client consults bare names before qualified ones.
      assert.throws(
        () => resolver.resolve(parameters({ name: 'token', value: 'wf' }), resolve),
        ResolverError,
        /declares no location/,
      );
    });

    specify('should throw ResolverError for a non-string location', function () {
      assert.throws(
        () =>
          resolver.resolve(
            parameters({ name: 'x', in: 1 as unknown as string, value: 'v' }),
            resolve,
          ),
        ResolverError,
        /non-string location/,
      );
    });

    specify('should throw when a querystring parameter shadows a qualified one', function () {
      // the two produce different keys ('token' and 'header.token'), so this
      // is not a key collision — but the client consults the bare name first
      // for every declared parameter bearing it, so the querystring entry
      // would silently capture the header's value.
      assert.throws(
        () =>
          resolver.resolve(
            parameters(
              { name: 'token', in: 'querystring', value: 'qs' },
              { name: 'token', in: 'header', value: 'secret' },
            ),
            resolve,
          ),
        ResolverError,
        /cannot be delivered unambiguously/,
      );
    });

    specify('should throw for the shadowing pair in either order', function () {
      assert.throws(
        () =>
          resolver.resolve(
            parameters(
              { name: 'token', in: 'header', value: 'secret' },
              { name: 'token', in: 'querystring', value: 'qs' },
            ),
            resolve,
          ),
        ResolverError,
        /cannot be delivered unambiguously/,
      );
    });

    specify('should throw ResolverError for a missing or non-string name', function () {
      // as loud as a malformed location: a silently dropped parameter would
      // surface only as a downstream request failure with nothing pointing at
      // the cause.
      assert.throws(
        () =>
          resolver.resolve(
            parameters({ name: 1 as unknown as string, in: 'query', value: 'v' }),
            resolve,
          ),
        ResolverError,
        /missing or non-string name/,
      );
    });

    specify('should store a bare parameter named __proto__ as an own property', function () {
      // bracket assignment would hit the __proto__ accessor and never create
      // an own property — silently losing the parameter, whatever its value.
      const result = resolver.resolve(
        parameters({ name: '__proto__', in: 'querystring', value: 'x' }),
        resolve,
      );

      assert.isTrue(Object.hasOwn(result, '__proto__'));
      assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
    });

    specify('should throw ResolverError when two parameters collide on one key', function () {
      // the '{in}.{name}' scheme is the client's and is not injective: a
      // querystring parameter named `query.id` and a query parameter named
      // `id` both produce the key `query.id`. Only one could be delivered, so
      // the ambiguity is reported rather than resolved silently.
      assert.throws(
        () =>
          resolver.resolve(
            parameters(
              { name: 'query.id', in: 'querystring', value: 'a' },
              { name: 'id', in: 'query', value: 'b' },
            ),
            resolve,
          ),
        ResolverError,
        /cannot be delivered unambiguously/,
      );
    });

    specify('should throw ResolverError for a present but non-list parameters', function () {
      // walking it would fail as a bare `TypeError: parameters is not iterable`
      // — raised by the language, naming an internal variable, and carrying
      // nothing a caller can branch on.
      const error = assert.throws(
        () => resolver.resolve('not-a-list' as never, resolve),
        ResolverError,
        /is present but is not a list/,
      ) as unknown as ResolverError;

      assert.strictEqual(error.reason, 'malformed-parameters');
      assert.strictEqual(error.target, 'parameters');
    });
  });
});
