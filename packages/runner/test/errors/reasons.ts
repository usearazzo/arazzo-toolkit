import { assert } from 'chai';

import {
  CriterionError,
  CriterionEvaluationError,
  ExecutionError,
  ResolverError,
  RuntimeExpressionError,
} from '../../src/index.ts';
import type {
  CriterionErrorReason,
  ExecutionErrorReason,
  ResolverErrorReason,
  RuntimeExpressionErrorReason,
} from '../../src/index.ts';

/**
 * The string-valued own static fields of an error class. `Object.keys` on a
 * class lists its own static fields only, the same set the derived
 * `XErrorReason` union covers.
 */
const reasonsOf = (errorClass: object): string[] =>
  Object.values(errorClass).filter((value) => typeof value === 'string');

describe('error reasons', function () {
  context('given the reason statics', function () {
    specify('should list only reason strings as own statics', function () {
      for (const errorClass of [
        CriterionError,
        ExecutionError,
        ResolverError,
        RuntimeExpressionError,
      ]) {
        assert.strictEqual(
          Object.keys(errorClass).length,
          reasonsOf(errorClass).length,
          `${errorClass.name} has a static that is not a reason string`,
        );
      }
    });

    specify('should let CriterionEvaluationError inherit the CriterionError reasons', function () {
      assert.strictEqual(CriterionEvaluationError.InvalidRegex, 'invalid-regex');
    });
  });

  context('given a reason passed to an error constructor', function () {
    // the `@ts-expect-error` lines are the assertions: `typescript:check-types`
    // covers test/, so it fails the moment a constructor accepts a reason its
    // class does not list
    specify('should type-check only the reasons the class lists', function () {
      const execution = new ExecutionError('x', { reason: ExecutionError.OperationNotFound });
      // @ts-expect-error a misspelled reason
      void new ExecutionError('x', { reason: 'operation-not-fund' });
      // @ts-expect-error another class's reason
      void new ExecutionError('x', { reason: CriterionError.InvalidRegex });
      // @ts-expect-error a misspelled reason
      void new ResolverError('x', { reason: 'malformed-parameter' });
      // @ts-expect-error a misspelled reason
      void new RuntimeExpressionError('x', { reason: 'parse-failure' });
      // @ts-expect-error a misspelled reason
      void new CriterionError('x', { reason: 'invalid-regexp' });
      // @ts-expect-error a misspelled reason
      void new CriterionEvaluationError('x', { reason: 'invalid-regexp' });

      assert.strictEqual(execution.reason, 'operation-not-found');
    });

    specify('should type reasons as the literal union, not string', function () {
      const reasons: [
        CriterionErrorReason,
        ExecutionErrorReason,
        ResolverErrorReason,
        RuntimeExpressionErrorReason,
      ] = [
        CriterionError.InvalidRegex,
        ExecutionError.Aborted,
        ResolverError.MissingName,
        RuntimeExpressionError.ParseError,
      ];
      // @ts-expect-error a plain string is not a reason
      const widened: ExecutionErrorReason = 'aborted' as string;

      assert.deepEqual(reasons, ['invalid-regex', 'aborted', 'missing-name', 'parse-error']);
      assert.strictEqual(widened, 'aborted');
    });
  });

  context('given a reason read off an error', function () {
    // as above, the `@ts-expect-error` lines are the assertions: comparing
    // `error.reason` with a string its class does not list must not compile
    specify('should type-check comparisons only against the reasons the class lists', function () {
      const criterion = new CriterionError('x', { reason: CriterionError.InvalidRegex });
      const evaluation = new CriterionEvaluationError('x', { reason: CriterionError.InvalidRegex });
      const execution = new ExecutionError('x', { reason: ExecutionError.Aborted });
      const resolver = new ResolverError('x', { reason: ResolverError.MissingName });
      const expression = new RuntimeExpressionError('x', {
        reason: RuntimeExpressionError.ParseError,
      });

      const comparisons = [
        // @ts-expect-error a misspelled reason
        criterion.reason === 'invalid-regexp',
        // @ts-expect-error a misspelled reason
        evaluation.reason === 'invalid-regexp',
        // @ts-expect-error a misspelled reason
        execution.reason === 'abort',
        // @ts-expect-error another class's reason
        execution.reason === ResolverError.MissingName,
        // @ts-expect-error a misspelled reason
        resolver.reason === 'missing-names',
        // @ts-expect-error a misspelled reason
        expression.reason === 'parse-failure',
      ];

      assert.deepEqual(comparisons, [false, false, false, false, false, false]);
      assert.isTrue(execution.reason === ExecutionError.Aborted);
    });
  });
});
