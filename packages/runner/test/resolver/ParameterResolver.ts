import { assert } from 'chai';
import { StepParametersElement, refractParameter } from '@speclynx/apidom-ns-arazzo-1';

import {
  ParameterResolver,
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

  context('resolve', function () {
    specify('should resolve a whole runtime expression to its typed value', function () {
      const result = resolver.resolve(
        parameters({ name: 'status', value: '$inputs.status' }),
        resolve,
      );

      assert.deepEqual(result, { status: 'available' });
    });

    specify('should preserve the referenced type', function () {
      const result = resolver.resolve(
        parameters({ name: 'limit', value: '$inputs.limit' }),
        resolve,
      );

      assert.strictEqual(result.limit, 10);
    });

    specify('should resolve a step output expression', function () {
      const result = resolver.resolve(
        parameters({ name: 'token', value: '$steps.login.outputs.token' }),
        resolve,
      );

      assert.deepEqual(result, { token: 'abc' });
    });

    specify('should use a literal string as-is', function () {
      const result = resolver.resolve(parameters({ name: 'q', value: 'available' }), resolve);

      assert.deepEqual(result, { q: 'available' });
    });

    specify('should use a literal number/boolean as-is', function () {
      const result = resolver.resolve(
        parameters({ name: 'n', value: 42 }, { name: 'b', value: true }),
        resolve,
      );

      assert.deepEqual(result, { n: 42, b: true });
    });

    specify(
      'should not interpolate a non-expression string (no embedded expressions in 1.0.1)',
      function () {
        // `{$inputs.x}` is a literal string in 1.0.1, not an embedded expression.
        const result = resolver.resolve(parameters({ name: 'raw', value: '{$inputs.x}' }), resolve);

        assert.deepEqual(result, { raw: '{$inputs.x}' });
      },
    );

    specify('should use a literal object value as-is', function () {
      const result = resolver.resolve(
        parameters({ name: 'obj', value: { a: 1, b: '$inputs.status' } }),
        resolve,
      );

      // the object is a literal; its string members are not resolved in 1.0.1.
      assert.deepEqual(result, { obj: { a: 1, b: '$inputs.status' } });
    });

    specify('should resolve multiple parameters keyed by name', function () {
      const result = resolver.resolve(
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
      assert.deepEqual(resolver.resolve(undefined, resolve), {});
    });

    specify('should let the earlier of two same-named parameters win', function () {
      // the list is ordered by precedence, most specific first — as the
      // normalizer leaves it once a step's own parameters have been merged with
      // the ones it inherits.
      const result = resolver.resolve(
        parameters(
          { name: 'trace', in: 'query', value: 'from-step' },
          { name: 'trace', in: 'header', value: 'from-workflow' },
        ),
        resolve,
      );

      assert.deepEqual(result, { trace: 'from-step' });
    });

    specify('should not mistake a parameter named after an Object property', function () {
      const result = resolver.resolve(
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
        const result = resolver.resolve(
          parameters({ name: 'x', value: '$inputs.missing' }),
          resolve,
        );

        assert.deepEqual(result, { x: undefined });
      },
    );
  });

  context('resolveQualified', function () {
    specify('should let parameters differing only in their location coexist', function () {
      // a parameter is unique by (name, in), so an operation may declare
      // `token` both as a header and as a query parameter — keying by bare
      // name would collapse them and silently drop one.
      const result = resolver.resolveQualified(
        parameters(
          { name: 'token', in: 'header', value: '$steps.login.outputs.token' },
          { name: 'token', in: 'query', value: 'legacy' },
        ),
        resolve,
      );

      assert.deepEqual(result, { 'header.token': 'abc', 'query.token': 'legacy' });
    });

    specify('should keep the bare name for a parameter without a location', function () {
      const result = resolver.resolveQualified(
        parameters({ name: 'status', value: '$inputs.status' }),
        resolve,
      );

      assert.deepEqual(result, { status: 'available' });
    });

    specify('should let the earlier of two same-(name, in) parameters win', function () {
      // the qualified key is exactly the (name, in) identity the normalizer
      // merges on, so only a genuinely same parameter can shadow another — and
      // the list leads with the most specific, the step's own.
      const result = resolver.resolveQualified(
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
      // rather than splitting the key), so the dots compose without ambiguity.
      const result = resolver.resolveQualified(
        parameters({ name: 'filter.name', in: 'query', value: 'rex' }),
        resolve,
      );

      assert.deepEqual(result, { 'query.filter.name': 'rex' });
    });
  });
});
