import { assert } from 'chai';
import {
  StepOnSuccessElement,
  StepOnFailureElement,
  refractSuccessAction,
  refractFailureAction,
  isCriterionElement,
  isSuccessActionElement,
  isFailureActionElement,
  type CriterionElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { toValue } from '@speclynx/apidom-core';

import {
  ActionResolver,
  ResolverError,
  type CriterionPredicate,
  type SelectedAction,
} from '../../src/index.ts';

describe('ActionResolver', function () {
  const stepId = 'step1';
  const scope = { stepId };
  let resolver: ActionResolver;

  beforeEach(function () {
    resolver = new ActionResolver();
  });

  // a predicate that treats a criterion whose condition is 'pass' as met.
  const byCondition: CriterionPredicate = (criterion: CriterionElement) =>
    isCriterionElement(criterion) && toValue(criterion.condition) === 'pass';
  const always: CriterionPredicate = () => true;

  const onSuccess = (...actions: unknown[]): StepOnSuccessElement =>
    new StepOnSuccessElement(actions.map((a) => refractSuccessAction(a)));
  const onFailure = (...actions: unknown[]): StepOnFailureElement =>
    new StepOnFailureElement(actions.map((a) => refractFailureAction(a)));

  context('selection', function () {
    specify('should select the first action whose criteria all pass', function () {
      const actions = onSuccess(
        { name: 'a', type: 'goto', stepId: 'first', criteria: [{ condition: 'fail' }] },
        { name: 'b', type: 'goto', stepId: 'second', criteria: [{ condition: 'pass' }] },
        { name: 'c', type: 'goto', stepId: 'third', criteria: [{ condition: 'pass' }] },
      );

      const selected = resolver.resolveOnSuccess(actions, byCondition, scope)[0];
      assert.isTrue(isSuccessActionElement(selected));
      assert.strictEqual(toValue(selected?.stepId), 'second');
    });

    specify('should require all of an action criteria to pass', function () {
      const actions = onSuccess({
        name: 'a',
        type: 'end',
        criteria: [{ condition: 'pass' }, { condition: 'fail' }],
      });

      assert.isUndefined(resolver.resolveOnSuccess(actions, byCondition, scope)[0]);
    });

    specify('should treat an action with no criteria as always matching', function () {
      const selected = resolver.resolveOnSuccess(
        onSuccess({ name: 'a', type: 'end' }),
        byCondition,
        scope,
      )[0];

      assert.strictEqual(toValue(selected?.type), 'end');
    });

    specify('should treat an action with an empty criteria list as matching', function () {
      const selected = resolver.resolveOnSuccess(
        onSuccess({ name: 'a', type: 'end', criteria: [] }),
        byCondition,
        scope,
      )[0];

      assert.strictEqual(toValue(selected?.type), 'end');
    });

    specify('should return undefined when no action matches', function () {
      const actions = onSuccess({ name: 'a', type: 'end', criteria: [{ condition: 'fail' }] });

      assert.isUndefined(resolver.resolveOnSuccess(actions, byCondition, scope)[0]);
    });

    specify('should return undefined when the action list is absent', function () {
      assert.isUndefined(resolver.resolveOnSuccess(undefined, always, scope)[0]);
    });
  });

  context('selected action element', function () {
    const select = (action: unknown, predicate = always): SelectedAction | undefined =>
      resolver.resolveOnFailure(onFailure(action), predicate, scope)[0];

    specify('should return the goto action element with its target', function () {
      const selected = resolver.resolveOnSuccess(
        onSuccess({ name: 'a', type: 'goto', stepId: 'next' }),
        always,
        scope,
      )[0];

      assert.strictEqual(toValue(selected?.type), 'goto');
      assert.strictEqual(toValue(selected?.stepId), 'next');
    });

    specify('should return the retry action element with its bounds', function () {
      const selected = select({ name: 'a', type: 'retry', retryAfter: 3, retryLimit: 5 });

      assert.isTrue(isFailureActionElement(selected));
      assert.strictEqual(toValue(selected?.type), 'retry');
      assert.strictEqual(toValue((selected as { retryAfter?: unknown }).retryAfter), 3);
      assert.strictEqual(toValue((selected as { retryLimit?: unknown }).retryLimit), 5);
    });

    specify('should return the workflow-transfer action element', function () {
      const selected = select({ name: 'a', type: 'goto', workflowId: 'wf' });

      assert.strictEqual(toValue(selected?.workflowId), 'wf');
    });

    specify('should throw ResolverError for a present but non-list action list', function () {
      // walking it would fail as a bare `TypeError: actions is not iterable`.
      const error = assert.throws(
        () => resolver.resolveOnFailure('not-a-list' as never, byCondition, scope),
        ResolverError,
        /is present but is not a list/,
      ) as unknown as ResolverError;

      assert.strictEqual(error.reason, 'malformed-actions');
      assert.strictEqual(error.stepId, stepId);
    });

    specify(
      "should throw ResolverError for an action's present but non-list criteria",
      function () {
        const actions = new StepOnSuccessElement([
          refractSuccessAction({ name: 'a', type: 'end', criteria: 'not-a-list' }),
        ]);

        const error = assert.throws(
          () => resolver.resolveOnSuccess(actions, byCondition, scope),
          ResolverError,
          /is present but is not a list/,
        ) as unknown as ResolverError;

        assert.strictEqual(error.reason, 'malformed-criteria');
        assert.strictEqual(error.target, 'criteria');
        assert.strictEqual(error.stepId, stepId);
      },
    );

    specify(
      'should throw ResolverError for a well-formed list entry that is not a Success/Failure Action Object',
      function () {
        const actions = onSuccess({ name: 'a', type: 'end' }, 'not-an-action');

        const error = assert.throws(
          () => resolver.resolveOnSuccess(actions, always, scope),
          ResolverError,
          /contains an entry that is not a Success\/Failure Action Object/,
        ) as unknown as ResolverError;

        assert.strictEqual(error.reason, 'malformed-action-entry');
        assert.strictEqual(error.target, 'onSuccess');
        assert.strictEqual(error.stepId, stepId);
      },
    );

    specify(
      'should throw ResolverError for an action criteria entry that is not a Criterion Object',
      function () {
        const actions = new StepOnSuccessElement([
          refractSuccessAction({ name: 'a', type: 'end', criteria: ['not-a-criterion'] }),
        ]);

        const error = assert.throws(
          () => resolver.resolveOnSuccess(actions, byCondition, scope),
          ResolverError,
          /contains an entry that is not a Criterion Object/,
        ) as unknown as ResolverError;

        assert.strictEqual(error.reason, 'malformed-criterion');
        assert.strictEqual(error.target, 'criteria');
        assert.strictEqual(error.stepId, stepId);
      },
    );
  });
});
