import { assert } from 'chai';

import {
  XPathCriterionEvaluator,
  CriterionEvaluationError,
  CriterionErrorReason,
} from '../../src/index.ts';

describe('XPathCriterionEvaluator', function () {
  let evaluator: XPathCriterionEvaluator;

  const xml =
    '<order><status>available</status><items><item id="1"/><item id="2"/></items></order>';

  beforeEach(function () {
    evaluator = new XPathCriterionEvaluator();
  });

  context('evaluate', function () {
    specify('should be met for a true boolean predicate (Effective Boolean Value)', function () {
      assert.isTrue(evaluator.evaluate("//status = 'available'", xml));
    });

    specify('should not be met for a false boolean predicate', function () {
      assert.isFalse(evaluator.evaluate("//status = 'sold'", xml));
    });

    specify('should be met for a non-empty node selection', function () {
      assert.isTrue(evaluator.evaluate('//item', xml));
    });

    specify('should not be met for an empty node selection', function () {
      assert.isFalse(evaluator.evaluate('//missing', xml));
    });

    specify('should evaluate an XPath 3.1 function', function () {
      assert.isTrue(evaluator.evaluate("string-join(//item/@id, ',') = '1,2'", xml));
    });

    specify('should fail on a null context (Arazzo 1.1.0)', function () {
      assert.isFalse(evaluator.evaluate('//status', null));
    });

    specify('should fail on an undefined context (Arazzo 1.1.0)', function () {
      assert.isFalse(evaluator.evaluate('//status', undefined));
    });

    specify('should throw CriterionEvaluationError for an invalid XPath query', function () {
      assert.throws(() => evaluator.evaluate('//[', xml), CriterionEvaluationError);
    });

    specify('should throw CriterionEvaluationError for a non-XML (object) context', function () {
      const error = assert.throws(
        () => evaluator.evaluate('//status', { status: 'available' }),
        CriterionEvaluationError,
      ) as unknown as CriterionEvaluationError;

      assert.strictEqual(error.reason, CriterionErrorReason.InvalidXPathContext);
    });

    specify('should throw CriterionEvaluationError for fatally malformed XML', function () {
      assert.throws(
        () => evaluator.evaluate('//status', '<a><unclosed>'),
        CriterionEvaluationError,
      );
    });

    specify('should throw CriterionEvaluationError for recoverably malformed XML', function () {
      // an undefined entity is a recoverable error in xmldom — it does not throw
      // and would otherwise yield a degraded document evaluated silently.
      assert.throws(() => evaluator.evaluate('//status', '<a>&foo;</a>'), CriterionEvaluationError);
    });

    specify('should reject a JSON object that carries a numeric nodeType as non-XML', function () {
      // must not be mistaken for a parsed DOM node.
      assert.throws(
        () => evaluator.evaluate('//status', { nodeType: 3, status: 'x' }),
        CriterionEvaluationError,
      );
    });
  });
});
