import { assert } from 'chai';
import { StepOutputsElement } from '@speclynx/apidom-ns-arazzo-1';

import {
  OutputResolver,
  RuntimeExpressionEvaluator,
  type RuntimeExpressionResolver,
} from '../../src/index.ts';

describe('OutputResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    {
      response: { statusCode: 200, body: { token: 'abc', user: { id: 42 } } },
      steps: { login: { outputs: { session: 's-1' } } },
    },
    { strict: false },
  );
  const resolve: RuntimeExpressionResolver = (expression) => runtime.evaluate(expression);
  let resolver: OutputResolver;

  beforeEach(function () {
    resolver = new OutputResolver();
  });

  context('resolve', function () {
    specify('should resolve each output expression to its typed value', function () {
      const outputs = new StepOutputsElement({
        token: '$response.body#/token',
        userId: '$response.body#/user/id',
      });

      assert.deepEqual(resolver.resolve(outputs, resolve), { token: 'abc', userId: 42 });
    });

    specify('should resolve an output referencing a prior step', function () {
      const outputs = new StepOutputsElement({ session: '$steps.login.outputs.session' });

      assert.deepEqual(resolver.resolve(outputs, resolve), { session: 's-1' });
    });

    specify('should return an empty object when outputs are absent', function () {
      assert.deepEqual(resolver.resolve(undefined, resolve), {});
    });

    specify('should store an output named __proto__ as an own property', function () {
      // bracket assignment would hit the __proto__ accessor and never create
      // an own property — silently losing the output, whatever its value.
      // computed key: a literal `__proto__:` would set the object's prototype
      // instead of authoring a member named __proto__
      const outputs = new StepOutputsElement({ ['__proto__']: '$response.body#/token' });

      const result = resolver.resolve(outputs, resolve);

      assert.isTrue(Object.hasOwn(result, '__proto__'));
      assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
    });

    specify('should resolve an unresolvable output to undefined (lenient)', function () {
      const outputs = new StepOutputsElement({ missing: '$response.body#/nope' });

      assert.deepEqual(resolver.resolve(outputs, resolve), { missing: undefined });
    });

    specify(
      'should not interpolate a non-expression string (no embedded expressions in 1.0.1)',
      function () {
        const outputs = new StepOutputsElement({ raw: '{$response.body#/token}' });

        assert.deepEqual(resolver.resolve(outputs, resolve), { raw: '{$response.body#/token}' });
      },
    );
  });
});
