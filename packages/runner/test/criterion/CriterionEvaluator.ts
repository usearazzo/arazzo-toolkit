import { assert } from 'chai';
import { refractCriterion, ExpressionTypeElement } from '@speclynx/apidom-ns-arazzo-1';

import {
  CriterionEvaluator,
  CriterionError,
  CriterionEvaluationError,
  RegexCriterionEvaluator,
  RuntimeExpressionEvaluator,
  type CriterionContextResolver,
} from '../../src/index.ts';

describe('CriterionEvaluator', function () {
  // the resolver bridges a criterion's `context` to the runtime expression
  // evaluator, leniently so an unresolvable context fails the criterion.
  const runtime = new RuntimeExpressionEvaluator(
    {
      response: { statusCode: 200, body: { status: 'Available', pets: [{ id: 1 }] } },
      inputs: { xml: '<order><status>available</status></order>' },
    },
    { strict: false },
  );
  const resolve: CriterionContextResolver = (expression) => runtime.evaluate(expression);
  const evaluator = new CriterionEvaluator();

  const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
    try {
      await promise;
    } catch (error) {
      return error;
    }
    return assert.fail('expected promise to reject, but it resolved');
  };

  context('regex type', function () {
    specify('should evaluate the spec $statusCode regex example to true', async function () {
      // - context: $statusCode
      //   condition: '^200$'
      //   type: regex
      const criterion = refractCriterion({
        context: '$statusCode',
        condition: '^200$',
        type: 'regex',
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should evaluate to false when the pattern does not match', async function () {
      const criterion = refractCriterion({
        context: '$statusCode',
        condition: '^404$',
        type: 'regex',
      });

      assert.isFalse((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should match against a resolved response body value', async function () {
      const criterion = refractCriterion({
        context: '$response.body#/status',
        condition: 'Available',
        type: 'regex',
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should fail when the context runtime expression is unresolvable', async function () {
      const criterion = refractCriterion({
        context: '$response.body#/missing',
        condition: '^.*$',
        type: 'regex',
      });

      assert.isFalse((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should read the type from a Criterion Expression Type Object', async function () {
      const criterion = refractCriterion({ context: '$statusCode', condition: '^200$' });
      criterion.type = new ExpressionTypeElement({ type: 'regex' });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should throw when a regex criterion has no context', async function () {
      const criterion = refractCriterion({ condition: '^200$', type: 'regex' });

      assert.instanceOf(
        await captureRejection(evaluator.evaluate(criterion, resolve)),
        CriterionError,
      );
    });
  });

  context('simple type (default)', function () {
    specify('should evaluate a simple condition when type is omitted', async function () {
      const criterion = refractCriterion({ condition: '$statusCode == 200' });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should evaluate a false simple condition without an error', async function () {
      const criterion = refractCriterion({ condition: '$statusCode == 404' });

      assert.deepEqual(await evaluator.evaluate(criterion, resolve), { met: false });
    });

    specify('should not require a context for a simple condition', async function () {
      // simple embeds its expressions in the condition — no separate context.
      const criterion = refractCriterion({
        condition: "$response.body.status == 'available'",
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });
  });

  context('jsonpath type', function () {
    specify('should evaluate a jsonpath query against the resolved context', async function () {
      const criterion = refractCriterion({
        context: '$response.body',
        condition: '$.pets[*]',
        type: 'jsonpath',
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should not be met when the query matches nothing', async function () {
      const criterion = refractCriterion({
        context: '$response.body',
        condition: '$.orders[*]',
        type: 'jsonpath',
      });

      assert.isFalse((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should accept an explicit rfc9535 version', async function () {
      const criterion = refractCriterion({ context: '$response.body', condition: '$.pets[*]' });
      criterion.type = new ExpressionTypeElement({ type: 'jsonpath', version: 'rfc9535' });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should throw for a non-rfc9535 jsonpath version', async function () {
      const criterion = refractCriterion({ context: '$response.body', condition: '$.pets[*]' });
      criterion.type = new ExpressionTypeElement({
        type: 'jsonpath',
        version: 'draft-goessner-dispatch-jsonpath-00',
      });

      const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

      assert.instanceOf(error, CriterionError);
      assert.match(error.message, /Unsupported jsonpath version/);
    });

    specify(
      'should throw for a present-but-non-string version rather than defaulting',
      async function () {
        const criterion = refractCriterion({ context: '$response.body', condition: '$.pets[*]' });
        // a version that is present but not a string is malformed — it must not
        // silently fall back to the default rfc9535.
        criterion.type = new ExpressionTypeElement({ type: 'jsonpath', version: 42 });

        const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

        assert.instanceOf(error, CriterionError);
        assert.match(error.message, /invalid expression type "version"/);
      },
    );
  });

  context('xpath type', function () {
    specify('should evaluate an xpath query against the resolved XML context', async function () {
      const criterion = refractCriterion({
        context: '$inputs.xml',
        condition: "//status = 'available'",
        type: 'xpath',
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should not be met when the predicate is false', async function () {
      const criterion = refractCriterion({
        context: '$inputs.xml',
        condition: "//status = 'sold'",
        type: 'xpath',
      });

      assert.isFalse((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should accept an explicit xpath-31 version', async function () {
      const criterion = refractCriterion({ context: '$inputs.xml', condition: '//status' });
      criterion.type = new ExpressionTypeElement({ type: 'xpath', version: 'xpath-31' });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });

    specify('should throw for a non-xpath-31 version', async function () {
      const criterion = refractCriterion({ context: '$inputs.xml', condition: '//status' });
      criterion.type = new ExpressionTypeElement({ type: 'xpath', version: 'xpath-30' });

      const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

      assert.instanceOf(error, CriterionError);
      assert.match(error.message, /Unsupported xpath version/);
    });
  });

  context('condition and type validation', function () {
    specify('should throw when the condition is missing', async function () {
      const criterion = refractCriterion({ context: '$statusCode', type: 'regex' });

      assert.instanceOf(
        await captureRejection(evaluator.evaluate(criterion, resolve)),
        CriterionError,
      );
    });

    specify('should throw when the condition is an empty string', async function () {
      const criterion = refractCriterion({ context: '$statusCode', condition: '', type: 'regex' });

      const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

      assert.instanceOf(error, CriterionError);
      assert.match(error.message, /missing/);
    });

    specify(
      'should throw for a present-but-malformed type rather than defaulting',
      async function () {
        const criterion = refractCriterion({ context: '$statusCode', condition: '^200$' });
        // a Criterion Expression Type Object with no inner `type` is present but
        // unreadable — it must not silently degrade to `simple`.
        criterion.type = new ExpressionTypeElement();

        const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

        assert.instanceOf(error, CriterionError);
        assert.match(error.message, /invalid "type"/);
      },
    );

    specify(
      'should throw "unknown type" for jsonpointer (a version value, not a type)',
      async function () {
        // jsonpointer is an allowed expression-type *version* value, not one of the
        // criterion `type` options (simple/regex/jsonpath/xpath).
        const criterion = refractCriterion({
          context: '$response.body',
          condition: '/pets',
          type: 'jsonpointer',
        });

        const error = (await captureRejection(evaluator.evaluate(criterion, resolve))) as Error;

        assert.instanceOf(error, CriterionError);
        assert.match(error.message, /Unknown criterion type/);
      },
    );
  });

  context('evaluation errors (Arazzo 1.1.0)', function () {
    // a condition that cannot be evaluated MUST evaluate to fail, rather than
    // abort the step.
    const cases = [
      { type: 'simple', condition: '$statusCode ==', reason: CriterionError.InvalidSimple },
      {
        type: 'regex',
        context: '$statusCode',
        condition: '^(200',
        reason: CriterionError.InvalidRegex,
      },
      {
        type: 'jsonpath',
        context: '$response.body',
        condition: '$[?',
        reason: CriterionError.InvalidJSONPath,
      },
      {
        type: 'xpath',
        context: '$inputs.xml',
        condition: '//status[',
        reason: CriterionError.InvalidXPath,
      },
      // a context the condition cannot apply to: JSON data under an xpath query.
      {
        type: 'xpath',
        context: '$response.body',
        condition: '//status',
        reason: CriterionError.InvalidXPathContext,
      },
    ];

    for (const { type, context: criterionContext, condition, reason } of cases) {
      specify(
        `should fail a ${type} criterion "${condition}" on ${criterionContext ?? 'no context'}`,
        async function () {
          const criterion = refractCriterion({
            ...(criterionContext === undefined ? {} : { context: criterionContext }),
            condition,
            type,
          });

          const outcome = await evaluator.evaluate(criterion, resolve);

          assert.isFalse(outcome.met);
          assert.instanceOf(outcome.error, CriterionEvaluationError);
          assert.strictEqual(outcome.error?.reason, reason);
        },
      );
    }

    specify('should let a non-criterion error from the resolver propagate', async function () {
      const criterion = refractCriterion({ condition: '$statusCode == 200' });
      const failure = new Error('resolver failure');

      const error = await captureRejection(
        evaluator.evaluate(criterion, () => {
          throw failure;
        }),
      );

      assert.strictEqual(error, failure);
    });

    specify(
      'should let a structural CriterionError from an injected evaluator propagate',
      async function () {
        // only a CriterionEvaluationError marks an unevaluable condition; any other
        // CriterionError an evaluator raises is not absorbed as an unmet criterion.
        class MisconfiguredRegexEvaluator extends RegexCriterionEvaluator {
          override evaluate(): boolean {
            throw new CriterionError('misconfigured', { reason: CriterionError.InvalidType });
          }
        }
        const injected = new CriterionEvaluator({ regex: new MisconfiguredRegexEvaluator() });
        const criterion = refractCriterion({
          context: '$statusCode',
          condition: '^200$',
          type: 'regex',
        });

        const error = (await captureRejection(
          injected.evaluate(criterion, resolve),
        )) as CriterionError;

        assert.instanceOf(error, CriterionError);
        assert.isFalse(error instanceof CriterionEvaluationError);
        assert.strictEqual(error.reason, CriterionError.InvalidType);
      },
    );
  });

  context('context validation', function () {
    for (const type of ['simple', 'regex']) {
      specify(
        `should reject a context that is not a runtime expression (${type})`,
        async function () {
          const criterion = refractCriterion({
            context: 'response',
            condition: '$statusCode == 200',
            type,
          });

          const error = (await captureRejection(
            evaluator.evaluate(criterion, resolve),
          )) as CriterionError;

          assert.instanceOf(error, CriterionError);
          assert.match(error.message, /not a valid runtime expression/);
          assert.strictEqual(error.reason, CriterionError.InvalidContext);
        },
      );
    }

    specify('should accept a simple criterion with a valid context', async function () {
      const criterion = refractCriterion({
        context: '$response.body',
        condition: '$statusCode == 200',
        type: 'simple',
      });

      assert.isTrue((await evaluator.evaluate(criterion, resolve)).met);
    });
  });
});
