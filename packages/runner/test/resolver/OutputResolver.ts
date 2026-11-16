import { assert } from 'chai';
import { StepOutputsElement } from '@speclynx/apidom-ns-arazzo-1';

import {
  OutputResolver,
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

describe('OutputResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    {
      response: { statusCode: 200, body: { token: 'abc', user: { id: 42 } } },
      steps: { login: { outputs: { session: 's-1' } } },
    },
    { strict: false },
  );
  const resolve: RuntimeExpressionResolver = (expression) => runtime.evaluate(expression);
  const stepScope = { stepId: 'step1' };
  let resolver: OutputResolver;

  beforeEach(function () {
    resolver = new OutputResolver();
  });

  context('resolve', function () {
    specify('should resolve each output expression to its typed value', async function () {
      const outputs = new StepOutputsElement({
        token: '$response.body#/token',
        userId: '$response.body#/user/id',
      });

      assert.deepEqual(await resolver.resolve(outputs, resolve, stepScope), {
        token: 'abc',
        userId: 42,
      });
    });

    specify('should resolve an output referencing a prior step', async function () {
      const outputs = new StepOutputsElement({ session: '$steps.login.outputs.session' });

      assert.deepEqual(await resolver.resolve(outputs, resolve, stepScope), { session: 's-1' });
    });

    specify('should return an empty object when outputs are absent', async function () {
      assert.deepEqual(await resolver.resolve(undefined, resolve, stepScope), {});
    });

    specify('should store an output named __proto__ as an own property', async function () {
      // bracket assignment would hit the __proto__ accessor and never create
      // an own property — silently losing the output, whatever its value.
      // computed key: a literal `__proto__:` would set the object's prototype
      // instead of authoring a member named __proto__
      const outputs = new StepOutputsElement({ ['__proto__']: '$response.body#/token' });

      const result = await resolver.resolve(outputs, resolve, stepScope);

      assert.isTrue(Object.hasOwn(result, '__proto__'));
      assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
    });

    specify('should resolve an unresolvable output to undefined (lenient)', async function () {
      const outputs = new StepOutputsElement({ missing: '$response.body#/nope' });

      assert.deepEqual(await resolver.resolve(outputs, resolve, stepScope), {
        missing: undefined,
      });
    });

    specify('should throw for an output that is not a valid runtime expression', async function () {
      // `$response.body.id` is not Arazzo syntax (`$response.body#/id` is)
      const outputs = new StepOutputsElement({ orderId: '$response.body.id' });

      const error = await captureRejection(resolver.resolve(outputs, resolve, stepScope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /Output "orderId" is not a valid runtime expression/);
      assert.strictEqual(error.reason, 'invalid-expression');
      assert.strictEqual(error.target, 'outputs');
      assert.strictEqual(error.stepId, stepScope.stepId);
    });

    specify('should throw for a literal string output', async function () {
      const outputs = new StepOutputsElement({ raw: '{$response.body#/token}' });

      const error = await captureRejection(resolver.resolve(outputs, resolve, stepScope));

      assert.instanceOf(error, ResolverError);
      assert.strictEqual(error.reason, 'invalid-expression');
    });

    specify('should throw for a non-string output', async function () {
      const outputs = new StepOutputsElement({ count: 3 });

      const error = await captureRejection(resolver.resolve(outputs, resolve, stepScope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /Output "count"/);
      assert.strictEqual(error.reason, 'invalid-expression');
    });

    specify('should throw ResolverError for a present but non-map outputs', async function () {
      // the map-shaped counterpart: the walk is a `forEach`, so this would
      // otherwise fail as `outputs.forEach is not a function`.
      const error = await captureRejection(
        resolver.resolve('not-a-map' as never, resolve, stepScope),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /is present but is not a map/);
      assert.strictEqual(error.reason, 'malformed-outputs');
      assert.strictEqual(error.target, 'outputs');
      assert.strictEqual(error.stepId, stepScope.stepId);
    });

    specify(
      'should attribute a thrown ResolverError to the workflow when resolving workflow outputs',
      async function () {
        const workflowScope = { workflowId: 'wf1' };

        const error = await captureRejection(
          resolver.resolve('not-a-map' as never, resolve, workflowScope),
        );

        assert.instanceOf(error, ResolverError);
        assert.match(error.message, /is present but is not a map/);
        assert.strictEqual(error.workflowId, workflowScope.workflowId);
        assert.isUndefined(error.stepId);
      },
    );
  });
});
