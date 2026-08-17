import StepTransitionInterpreter from '../../src/executor/StepTransitionInterpreter.ts';
import { ExecutionError, type SelectedAction } from '../../src/index.ts';
import { assert } from 'chai';
import {
  refractStep,
  refractSuccessAction,
  refractFailureAction,
  isStepElement,
  isSuccessActionElement,
  isFailureActionElement,
} from '@speclynx/apidom-ns-arazzo-1';

describe('StepTransitionInterpreter', function () {
  let interpreter: StepTransitionInterpreter;
  const stepContext = { workflowId: 'wf', stepId: 'current' };

  beforeEach(function () {
    interpreter = new StepTransitionInterpreter();
  });

  // actions are narrowed through the namespace predicates rather than cast, so
  // each one is also checked to have refracted into the element it claims to be.
  const onSuccess = (action: unknown): SelectedAction => {
    const [element] = [refractSuccessAction(action)].filter(isSuccessActionElement);
    assert.isDefined(element);
    return element;
  };
  const onFailure = (action: unknown): SelectedAction => {
    const [element] = [refractFailureAction(action)].filter(isFailureActionElement);
    assert.isDefined(element);
    return element;
  };
  const steps = (...stepIds: string[]) =>
    stepIds.map((stepId) => refractStep({ stepId })).filter(isStepElement);

  // `indexOfStep`'s `descriptor` is mandatory (no goto-flavored default), so
  // every caller — including these tests — names which lookup it is.
  const gotoDescriptor = { reason: 'goto-target-not-found', label: 'goto target' };

  /**
   * Runs an interpretation expected to be rejected and returns the
   * ExecutionError, so a test can assert on its `reason`.
   */
  const captureError = (interpret: () => unknown): ExecutionError => {
    let caught: unknown;
    try {
      interpret();
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, ExecutionError);
    return caught as ExecutionError;
  };

  context('path defaults', function () {
    specify('should advance to the next step when a step succeeds unremarkably', function () {
      assert.deepEqual(interpreter.interpret(undefined, true, stepContext), { kind: 'next' });
    });

    specify('should break and return when a failing step matched no action', function () {
      assert.deepEqual(interpreter.interpret(undefined, false, stepContext), { kind: 'break' });
    });
  });

  context('end', function () {
    specify('should end the workflow from either path', function () {
      const success = onSuccess({ name: 'stop', type: 'end' });
      const failure = onFailure({ name: 'stop', type: 'end' });

      assert.deepEqual(interpreter.interpret(success, true, stepContext), { kind: 'end' });
      assert.deepEqual(interpreter.interpret(failure, false, stepContext), { kind: 'end' });
    });
  });

  context('goto', function () {
    specify('should jump to the named step', function () {
      const action = onSuccess({ name: 'jump', type: 'goto', stepId: 'later' });

      assert.deepEqual(interpreter.interpret(action, true, stepContext), {
        kind: 'goto',
        stepId: 'later',
      });
    });

    specify('should reject a goto targeting a workflow', function () {
      // the specification calls goto "a one-way transfer of workflow control",
      // whose return semantics are ambiguous — rejected rather than guessed at.
      const action = onSuccess({ name: 'jump', type: 'goto', workflowId: 'other' });

      const error = captureError(() => interpreter.interpret(action, true, stepContext));

      assert.strictEqual(error.reason, 'goto-workflow-unsupported');
    });

    specify('should reject a goto naming no target at all', function () {
      const action = onSuccess({ name: 'jump', type: 'goto' });

      const error = captureError(() => interpreter.interpret(action, true, stepContext));

      assert.strictEqual(error.reason, 'goto-target-missing');
    });
  });

  context('malformed actions', function () {
    specify('should reject an unknown action type', function () {
      const action = onSuccess({ name: 'bogus', type: 'teleport' });

      const error = captureError(() => interpreter.interpret(action, true, stepContext));

      assert.strictEqual(error.reason, 'unknown-action-type');
      assert.match(error.message, /unsupported type "teleport"/);
    });

    specify('should reject a retry, which the retry runner should have settled', function () {
      // retry never reaches the interpreter in a real run; reaching it means the
      // retry chain leaked, which is a bug rather than a control flow.
      const action = onFailure({ name: 'again', type: 'retry' });

      assert.strictEqual(
        captureError(() => interpreter.interpret(action, false, stepContext)).reason,
        'unknown-action-type',
      );
    });
  });

  context('resolving a goto target', function () {
    specify('should find the target step by id', function () {
      assert.strictEqual(
        interpreter.indexOfStep(steps('a', 'b', 'c'), 'c', 'wf', gotoDescriptor),
        2,
      );
    });

    specify('should find a target earlier in the list (a backward jump)', function () {
      // nothing in the specification forbids jumping back; a loop is the author's
      // to bound, which the executor's step budget backstops.
      assert.strictEqual(
        interpreter.indexOfStep(steps('a', 'b', 'c'), 'a', 'wf', gotoDescriptor),
        0,
      );
    });

    specify('should reject a target that names no step in this workflow', function () {
      const error = captureError(() =>
        interpreter.indexOfStep(steps('a', 'b'), 'elsewhere', 'wf', gotoDescriptor),
      );

      assert.strictEqual(error.reason, 'goto-target-not-found');
    });

    specify('should use the given descriptor to name a different lookup', function () {
      // proves the reason/label are not hardcoded to goto's wording — a
      // `retry` reference lookup (or any future caller) reports as itself.
      const error = captureError(() =>
        interpreter.indexOfStep(steps('a', 'b'), 'elsewhere', 'wf', {
          reason: 'retry-target-not-found',
          label: 'retry reference',
        }),
      );

      assert.strictEqual(error.reason, 'retry-target-not-found');
      assert.match(error.message, /retry reference step "elsewhere" not found/);
    });
  });
});
