import { assert } from 'chai';

import { parseRuntimeExpression } from '../src/index.ts';

describe('parseRuntimeExpression', function () {
  context('given a valid runtime expression', function () {
    specify('should succeed and return the AST', function () {
      const { result, tree } = parseRuntimeExpression('$steps.myStep.outputs.result');

      assert.isTrue(result.success);
      assert.deepEqual(tree, {
        type: 'StepsExpression',
        stepId: 'myStep',
        field: 'outputs',
        outputName: 'result',
      });
    });

    specify('should parse a body reference with a JSON Pointer', function () {
      const { result, tree } = parseRuntimeExpression('$response.body#/pets/0/id');

      assert.isTrue(result.success);
      assert.strictEqual(tree?.type, 'ResponseExpression');
    });
  });

  context('given an invalid runtime expression', function () {
    specify('should fail without throwing and carry position diagnostics', function () {
      const { result, tree } = parseRuntimeExpression('$unknown.thing');

      assert.isFalse(result.success);
      assert.isUndefined(tree);
      assert.isNumber(result.maxMatched);
    });
  });

  context('given a non-string expression', function () {
    specify('should throw TypeError', function () {
      // @ts-expect-error - exercising the runtime contract for non-string input
      assert.throws(() => parseRuntimeExpression(42), TypeError);
    });
  });
});
