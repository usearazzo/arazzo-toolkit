import { assert } from 'chai';

import { parseCriterionCondition } from '../src/index.ts';

describe('parseCriterionCondition', function () {
  context('given a valid criterion condition', function () {
    specify('should succeed and return the AST', function () {
      const { result, tree } = parseCriterionCondition('$statusCode == 200');

      assert.isTrue(result.success);
      assert.strictEqual(tree?.type, 'BinaryExpression');
    });

    specify('should parse an embedded runtime expression sub-AST', function () {
      const { result, tree } = parseCriterionCondition("$response.body#/status == 'available'");

      assert.isTrue(result.success);
      assert.strictEqual(tree?.type, 'BinaryExpression');
      if (tree?.type === 'BinaryExpression') {
        assert.strictEqual(tree.left.type, 'RuntimeExpression');
      }
    });
  });

  context('given an invalid criterion condition', function () {
    specify('should fail without throwing and carry position diagnostics', function () {
      const { result, tree } = parseCriterionCondition('$statusCode ===');

      assert.isFalse(result.success);
      assert.isUndefined(tree);
      assert.isNumber(result.maxMatched);
    });
  });

  context('given a non-string condition', function () {
    specify('should throw TypeError', function () {
      // @ts-expect-error - exercising the runtime contract for non-string input
      assert.throws(() => parseCriterionCondition(42), TypeError);
    });
  });
});
