import WorkflowCallStack from '../../src/executor/WorkflowCallStack.ts';
import { ExecutionError } from '../../src/index.ts';
import { assert } from 'chai';

describe('WorkflowCallStack', function () {
  const ENTRY = 'file:///entry.yaml';
  const CHILD = 'file:///child.yaml';
  const root = (maxDepth = 32): WorkflowCallStack =>
    new WorkflowCallStack({ maxDepth, entryDocumentURI: ENTRY });

  /**
   * Runs a call that is expected to be rejected and returns the ExecutionError,
   * so a test can assert on its `reason` and `path`.
   */
  const captureError = (enter: () => unknown): ExecutionError => {
    let caught: unknown;
    try {
      enter();
    } catch (error) {
      caught = error;
    }
    assert.instanceOf(caught, ExecutionError);
    return caught as ExecutionError;
  };

  context('entering', function () {
    specify('should record the chain in order, outermost first', function () {
      const stack = root()
        .enter('a', 'root', ENTRY)
        .enter('b', 'step', ENTRY)
        .enter('c', 'dependsOn', ENTRY);

      assert.deepEqual(stack.path, ['a', 'b', 'c']);
    });

    specify('should leave the entered stack untouched', function () {
      // the value is immutable, which is what makes leaving implicit: the caller
      // keeps its own chain no matter what its callees do.
      const outer = root().enter('a', 'root', ENTRY);
      outer.enter('b', 'step', ENTRY);

      assert.deepEqual(outer.path, ['a']);
    });
  });

  context('cycles', function () {
    specify('should reject a workflow already in progress', function () {
      const stack = root().enter('a', 'root', ENTRY);

      const error = captureError(() => stack.enter('a', 'step', ENTRY));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['a', 'a']);
      assert.match(error.message, /forms a cycle \(a -> a\)/);
    });

    specify('should reject an indirect cycle', function () {
      const stack = root().enter('a', 'root', ENTRY).enter('b', 'step', ENTRY);

      const error = captureError(() => stack.enter('a', 'step', ENTRY));

      assert.strictEqual(error.reason, 'workflow-cycle');
      assert.deepEqual(error.path, ['a', 'b', 'a']);
    });

    specify('should name a loop of only dependsOn edges a dependency cycle', function () {
      const stack = root().enter('a', 'root', ENTRY).enter('b', 'dependsOn', ENTRY);

      const error = captureError(() => stack.enter('a', 'dependsOn', ENTRY));

      assert.strictEqual(error.reason, 'dependsOn-cycle');
    });

    specify('should name a loop containing a step call a workflow cycle', function () {
      // the loop crosses both mechanisms: a -> b by dependsOn, b -> a by a step
      // call. One stack sees it; neither mechanism alone would.
      const stack = root().enter('a', 'root', ENTRY).enter('b', 'dependsOn', ENTRY);

      const error = captureError(() => stack.enter('a', 'step', ENTRY));

      assert.strictEqual(error.reason, 'workflow-cycle');
    });

    specify('should judge only the edges that close the loop', function () {
      // the dependsOn edge into 'a' is outside the b -> c -> b loop, so it must
      // not make that loop look like a dependency cycle.
      const stack = root()
        .enter('a', 'dependsOn', ENTRY)
        .enter('b', 'step', ENTRY)
        .enter('c', 'dependsOn', ENTRY);

      const error = captureError(() => stack.enter('b', 'dependsOn', ENTRY));

      assert.strictEqual(error.reason, 'dependsOn-cycle');
      assert.deepEqual(error.path, ['a', 'b', 'c', 'b']);
    });

    specify('should allow a workflow that completed and unwound (a diamond)', function () {
      const top = root().enter('top', 'root', ENTRY);
      // 'shared' is reached on two separate paths; each visit unwinds before the
      // next, so neither is a cycle.
      assert.deepEqual(top.enter('left', 'step', ENTRY).enter('shared', 'step', ENTRY).path, [
        'top',
        'left',
        'shared',
      ]);
      assert.deepEqual(top.enter('right', 'step', ENTRY).enter('shared', 'step', ENTRY).path, [
        'top',
        'right',
        'shared',
      ]);
    });
  });

  context('document-qualified calls', function () {
    specify('should not mistake one workflowId in two documents for a cycle', function () {
      // the bare ids collide; the (documentURI, workflowId) identities do
      // not — two documents' workflows sharing an id are different workflows.
      const stack = root().enter('shared', 'root', ENTRY).enter('shared', 'step', CHILD);

      // foreign frames display qualified; entry-document frames stay bare.
      assert.deepEqual(stack.path, ['shared', `${CHILD}#shared`]);
    });

    specify('should detect a genuine re-entry across the document boundary', function () {
      const stack = root().enter('loopEntry', 'root', ENTRY).enter('callsBack', 'step', CHILD);

      const error = captureError(() => stack.enter('loopEntry', 'step', ENTRY));

      assert.strictEqual(error.reason, 'workflow-cycle');
      // each frame reports its own display form — bare for the entry
      // document, qualified for the foreign one.
      assert.deepEqual(error.path, ['loopEntry', `${CHILD}#callsBack`, 'loopEntry']);
    });
  });

  context('depth', function () {
    specify('should reject nesting past the limit', function () {
      const stack = root(2).enter('a', 'root', ENTRY).enter('b', 'step', ENTRY);

      const error = captureError(() => stack.enter('c', 'step', ENTRY));

      assert.strictEqual(error.reason, 'workflow-depth');
      assert.deepEqual(error.path, ['a', 'b', 'c']);
    });

    specify('should allow nesting up to the limit', function () {
      assert.deepEqual(root(2).enter('a', 'root', ENTRY).enter('b', 'step', ENTRY).path, [
        'a',
        'b',
      ]);
    });

    specify('should count the root workflow against the limit', function () {
      // a limit of 1 admits the workflow execute was called with, and nothing
      // nested inside it.
      const stack = root(1).enter('a', 'root', ENTRY);

      assert.strictEqual(
        captureError(() => stack.enter('b', 'step', ENTRY)).reason,
        'workflow-depth',
      );
    });

    specify('should report a cycle as a cycle even when the depth is also spent', function () {
      // both guards would fire; the cycle is the real cause and must be the one
      // reported, rather than a misleading "too deep".
      const stack = root(1).enter('a', 'root', ENTRY);

      assert.strictEqual(
        captureError(() => stack.enter('a', 'step', ENTRY)).reason,
        'workflow-cycle',
      );
    });
  });
});
