import { assert } from 'chai';
import { StepParametersElement, refractParameter } from '@speclynx/apidom-ns-arazzo-1';

import {
  ParameterResolver,
  ResolverError,
  RuntimeExpressionEvaluator,
  type ParameterValueResolver,
} from '../../src/index.ts';

describe('ParameterResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    { inputs: { status: 'available', limit: 10 }, steps: { login: { outputs: { token: 'abc' } } } },
    { strict: false },
  );
  const resolve: ParameterValueResolver = (expression) => runtime.evaluate(expression);
  let resolver: ParameterResolver;

  beforeEach(function () {
    resolver = new ParameterResolver();
  });

  const parameters = (
    ...entries: { name: string; in?: string; value: unknown }[]
  ): StepParametersElement =>
    new StepParametersElement(entries.map((entry) => refractParameter(entry)));

  context('resolveWorkflowInputs', function () {
    specify('should resolve a whole runtime expression to its typed value', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'status', value: '$inputs.status' }),
        resolve,
      );

      assert.deepEqual(result, { status: 'available' });
    });

    specify('should preserve the referenced type', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'limit', value: '$inputs.limit' }),
        resolve,
      );

      assert.strictEqual(result.limit, 10);
    });

    specify('should resolve a step output expression', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'token', value: '$steps.login.outputs.token' }),
        resolve,
      );

      assert.deepEqual(result, { token: 'abc' });
    });

    specify('should use a literal string as-is', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'q', value: 'available' }),
        resolve,
      );

      assert.deepEqual(result, { q: 'available' });
    });

    specify('should use a literal number/boolean as-is', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'n', value: 42 }, { name: 'b', value: true }),
        resolve,
      );

      assert.deepEqual(result, { n: 42, b: true });
    });

    specify(
      'should not interpolate a non-expression string (no embedded expressions in 1.0.1)',
      function () {
        // `{$inputs.x}` is a literal string in 1.0.1, not an embedded expression.
        const result = resolver.resolveWorkflowInputs(
          parameters({ name: 'raw', value: '{$inputs.x}' }),
          resolve,
        );

        assert.deepEqual(result, { raw: '{$inputs.x}' });
      },
    );

    specify('should use a literal object value as-is', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'obj', value: { a: 1, b: '$inputs.status' } }),
        resolve,
      );

      // the object is a literal; its string members are not resolved in 1.0.1.
      assert.deepEqual(result, { obj: { a: 1, b: '$inputs.status' } });
    });

    specify('should resolve multiple parameters keyed by name', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters(
          { name: 'status', value: '$inputs.status' },
          { name: 'limit', value: '$inputs.limit' },
          { name: 'page', value: 1 },
        ),
        resolve,
      );

      assert.deepEqual(result, { status: 'available', limit: 10, page: 1 });
    });

    specify('should return an empty object when parameters are absent', function () {
      assert.deepEqual(resolver.resolveWorkflowInputs(undefined, resolve), {});
    });

    specify('should let the earlier of two same-named parameters win', function () {
      // the list is ordered by precedence, most specific first — as the
      // normalizer leaves it once a step's own parameters have been merged with
      // the ones it inherits. Inputs are keyed by name alone, an inherited
      // location notwithstanding.
      const result = resolver.resolveWorkflowInputs(
        parameters(
          { name: 'trace', in: 'query', value: 'from-step' },
          { name: 'trace', in: 'header', value: 'from-workflow' },
        ),
        resolve,
      );

      assert.deepEqual(result, { trace: 'from-step' });
    });

    specify('should not mistake a parameter named after an Object property', function () {
      const result = resolver.resolveWorkflowInputs(
        parameters({ name: 'toString', value: 'first' }, { name: 'toString', value: 'second' }),
        resolve,
      );

      // `'toString' in {}` is true, so a naive presence check would drop the
      // first entry and let the second win.
      assert.deepEqual(result, { toString: 'first' });
    });

    specify(
      'should return undefined for an unresolvable expression (lenient resolver)',
      function () {
        const result = resolver.resolveWorkflowInputs(
          parameters({ name: 'x', value: '$inputs.missing' }),
          resolve,
        );

        assert.deepEqual(result, { x: undefined });
      },
    );
  });

  context('resolveRequestParameters', function () {
    specify('should let parameters differing only in their location coexist', function () {
      // a parameter is unique by (name, in), so an operation may declare
      // `token` both as a header and as a query parameter — keying by bare
      // name would collapse them and silently drop one.
      const result = resolver.resolveRequestParameters(
        parameters(
          { name: 'token', in: 'header', value: '$steps.login.outputs.token' },
          { name: 'token', in: 'query', value: 'legacy' },
        ),
        resolve,
      );

      assert.deepEqual(result, { 'header.token': 'abc', 'query.token': 'legacy' });
    });

    specify('should let the earlier of two same-(name, in) parameters win', function () {
      // the delivery key is exactly the (name, in) identity the normalizer
      // merges on, so only a genuinely same parameter can shadow another — and
      // the list leads with the most specific, the step's own.
      const result = resolver.resolveRequestParameters(
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
      const result = resolver.resolveRequestParameters(
        parameters({ name: 'filter.name', in: 'query', value: 'rex' }),
        resolve,
      );

      assert.deepEqual(result, { 'query.filter.name': 'rex' });
    });

    specify('should keep the bare name for the querystring location', function () {
      // legal in Arazzo, but no OpenAPI location — there is nothing to qualify
      // against, and the bare name can still reach a same-named declared
      // parameter, as it did before delivery was qualified.
      const result = resolver.resolveRequestParameters(
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
        () =>
          resolver.resolveRequestParameters(parameters({ name: 'token', value: 'wf' }), resolve),
        ResolverError,
        /declares no location/,
      );
    });

    specify('should throw ResolverError for a non-string location', function () {
      assert.throws(
        () =>
          resolver.resolveRequestParameters(
            parameters({ name: 'x', in: 1 as unknown as string, value: 'v' }),
            resolve,
          ),
        ResolverError,
        /non-string location/,
      );
    });

    specify('should throw ResolverError when two parameters collide on one key', function () {
      // the '{in}.{name}' scheme is the client's and is not injective: a
      // querystring parameter named `query.id` and a query parameter named
      // `id` both produce the key `query.id`. Only one could be delivered, so
      // the ambiguity is reported rather than resolved silently.
      assert.throws(
        () =>
          resolver.resolveRequestParameters(
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
  });
});
