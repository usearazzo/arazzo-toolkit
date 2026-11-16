import { assert } from 'chai';

import {
  SimpleCriterionEvaluator,
  CriterionEvaluationError,
  RuntimeExpressionEvaluator,
  type CriterionContextResolver,
} from '../../src/index.ts';

describe('SimpleCriterionEvaluator', function () {
  const runtime = new RuntimeExpressionEvaluator(
    {
      response: { statusCode: 200, body: { status: 'Available', data: [{ id: 42 }] } },
      inputs: { limit: 10 },
    },
    { strict: false },
  );
  const resolve: CriterionContextResolver = (expression) => runtime.evaluate(expression);
  let evaluator: SimpleCriterionEvaluator;

  const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    return assert.fail('expected promise to reject, but it resolved');
  };

  beforeEach(function () {
    evaluator = new SimpleCriterionEvaluator();
  });

  context('evaluate', function () {
    specify('should not resolve an operand that cannot change the outcome', async function () {
      const resolved: string[] = [];
      const tracking: CriterionContextResolver = async (expression) => {
        resolved.push(expression);
        if (expression === '$inputs.limit') throw new Error('must not be resolved');
        return runtime.evaluate(expression);
      };

      assert.isFalse(await evaluator.evaluate('$statusCode == 404 && $inputs.limit', tracking));
      assert.isTrue(await evaluator.evaluate('$statusCode == 200 || $inputs.limit', tracking));
      assert.deepEqual(resolved, ['$statusCode', '$statusCode']);
    });

    specify('should reject with an error the resolver raises', async function () {
      const failure = new Error('cannot load');

      const error = await captureRejection(
        evaluator.evaluate('$statusCode == 200 && $inputs.limit', async (expression) => {
          if (expression === '$inputs.limit') throw failure;
          return runtime.evaluate(expression);
        }),
      );

      assert.strictEqual(error, failure);
    });

    specify('should evaluate an equality comparison', async function () {
      assert.isTrue(await evaluator.evaluate('$statusCode == 200', resolve));
      assert.isFalse(await evaluator.evaluate('$statusCode == 404', resolve));
    });

    specify('should compare strings case-insensitively', async function () {
      assert.isTrue(await evaluator.evaluate("$response.body.status == 'available'", resolve));
    });

    specify('should evaluate relational operators', async function () {
      assert.isTrue(await evaluator.evaluate('$statusCode >= 200 && $statusCode < 300', resolve));
    });

    specify('should navigate member and index access', async function () {
      assert.isTrue(await evaluator.evaluate('$response.body.data[0].id > 10', resolve));
    });

    specify('should evaluate logical conjunction of expressions', async function () {
      assert.isTrue(
        await evaluator.evaluate(
          "$statusCode == 200 && $response.body.status == 'available'",
          resolve,
        ),
      );
      assert.isFalse(
        await evaluator.evaluate("$statusCode == 200 && $response.body.status == 'sold'", resolve),
      );
    });

    specify('should fail rather than throw when an operand is unresolvable', async function () {
      const lenient: CriterionContextResolver = () => undefined;
      assert.isFalse(await evaluator.evaluate('$statusCode == 200', lenient));
    });

    specify('should throw CriterionEvaluationError for a malformed condition', async function () {
      assert.instanceOf(
        await captureRejection(evaluator.evaluate('$statusCode ===', resolve)),
        CriterionEvaluationError,
      );
    });
  });
});
