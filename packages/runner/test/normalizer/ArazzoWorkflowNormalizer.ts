import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { toValue } from '@speclynx/apidom-core';
import {
  isWorkflowElement,
  refractWorkflow,
  type StepElement,
  type WorkflowElement,
} from '@speclynx/apidom-ns-arazzo-1';

import { DocumentRegistry, ArazzoDocument } from '../../src/index.ts';
import ArazzoWorkflowExtractor from '../../src/extractor/ArazzoWorkflowExtractor.ts';
import ArazzoWorkflowNormalizer from '../../src/normalizer/ArazzoWorkflowNormalizer.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'petstore-order-workflow.arazzo.yaml');
const componentFixturePath = path.join(
  __dirname,
  '..',
  'fixtures',
  'arazzo-with-components',
  'workflow.arazzo.yaml',
);

describe('ArazzoWorkflowNormalizer', function () {
  const extractor = new ArazzoWorkflowExtractor();
  const normalizer = new ArazzoWorkflowNormalizer();

  context('normalize', function () {
    let entryDoc: ArazzoDocument;

    before(async function () {
      const registry = new DocumentRegistry();
      entryDoc = await registry.acquireEntryDocument(fixturePath);
    });

    specify('should return a WorkflowElement', async function () {
      const workflow = extractor.extract(entryDoc, 'authenticateAndOrderPet');
      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.isTrue(isWorkflowElement(normalized));
    });

    specify('should preserve workflowId', async function () {
      const workflow = extractor.extract(entryDoc, 'authenticateAndOrderPet');
      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.strictEqual(toValue(normalized.workflowId), 'authenticateAndOrderPet');
    });
  });

  context('parameter inheritance', function () {
    let entryDoc: ArazzoDocument;

    before(async function () {
      const registry = new DocumentRegistry();
      entryDoc = await registry.acquireEntryDocument(fixturePath);
    });

    type ParameterEntry = { name?: string; in?: string; value?: unknown };

    /**
     * Normalizes a workflow built from plain values, returning the parameters
     * its steps end up with — one list per step, in step order.
     */
    const inherit = async (
      parameters: ParameterEntry[] | undefined,
      ...steps: { stepId: string; parameters?: ParameterEntry[] }[]
    ): Promise<(ParameterEntry[] | undefined)[]> => {
      const workflow = refractWorkflow({
        workflowId: 'w',
        ...(parameters === undefined ? {} : { parameters }),
        steps: steps.map((step) => ({ operationId: 'getInventory', ...step })),
      }) as WorkflowElement;
      const normalized = await normalizer.normalize(workflow, entryDoc);

      return (toValue(normalized.steps) as { parameters?: ParameterEntry[] }[]).map(
        (step) => step.parameters,
      );
    };

    specify('should inherit a workflow parameter into a step declaring none', async function () {
      const [step] = await inherit([{ name: 'status', in: 'query', value: 'available' }], {
        stepId: 'a',
      });

      assert.deepEqual(step, [{ name: 'status', in: 'query', value: 'available' }]);
    });

    specify('should inherit into every step of the workflow', async function () {
      const steps = await inherit(
        [{ name: 'status', in: 'query', value: 'available' }],
        { stepId: 'a' },
        { stepId: 'b' },
      );

      assert.deepEqual(steps[0], steps[1]);
      assert.lengthOf(steps[1]!, 1);
    });

    specify("should let a step's own parameter override the inherited one", async function () {
      const [step] = await inherit([{ name: 'status', in: 'query', value: 'pending' }], {
        stepId: 'a',
        parameters: [{ name: 'status', in: 'query', value: 'sold' }],
      });

      assert.deepEqual(step, [{ name: 'status', in: 'query', value: 'sold' }]);
    });

    specify("should order the step's own list ahead of what it inherits", async function () {
      const [step] = await inherit([{ name: 'inherited', in: 'query', value: 1 }], {
        stepId: 'a',
        parameters: [{ name: 'own', in: 'query', value: 2 }],
      });

      // matches how inheritParametersToOperation orders an Operation's
      // parameters ahead of the Path Item's it inherits.
      assert.deepEqual(step, [
        { name: 'own', in: 'query', value: 2 },
        { name: 'inherited', in: 'query', value: 1 },
      ]);
    });

    specify(
      'should treat the same name in different locations as two parameters',
      async function () {
        const [step] = await inherit([{ name: 'trace', in: 'header', value: 'from-workflow' }], {
          stepId: 'a',
          parameters: [{ name: 'trace', in: 'query', value: 'from-step' }],
        });

        // a step may override an inherited parameter but never remove it: these
        // are bound for two different places, so both survive.
        assert.deepEqual(step, [
          { name: 'trace', in: 'query', value: 'from-step' },
          { name: 'trace', in: 'header', value: 'from-workflow' },
        ]);
      },
    );

    specify('should treat an absent location as its own identity', async function () {
      // a workflowId step's parameters are workflow inputs and carry no `in`, so
      // name alone decides there — while an `in`-carrying parameter of the same
      // name remains a separate one. (The inherited input-shaped `token` is
      // also inapplicable to this operation step — either way it must not
      // displace the header one.)
      const [step] = await inherit(
        [
          { name: 'token', value: 'inherited-input' },
          { name: 'token', in: 'header', value: 'inherited-header' },
        ],
        { stepId: 'a', parameters: [{ name: 'token', value: 'own-input' }] },
      );

      assert.deepEqual(step, [
        { name: 'token', value: 'own-input' },
        { name: 'token', in: 'header', value: 'inherited-header' },
      ]);
    });

    specify(
      'should not inherit an input-shaped parameter into an operation step',
      async function () {
        // a parameter without `in` is a workflow-input mapping; it names no
        // request location, and planting it bare in an operation step's map
        // would let it outrank the step's own qualified values (the client
        // consults bare names first). The `in`-carrying sibling still arrives.
        const [step] = await inherit(
          [
            { name: 'petId', value: '7' },
            { name: 'status', in: 'query', value: 'available' },
          ],
          { stepId: 'a' },
        );

        assert.deepEqual(step, [{ name: 'status', in: 'query', value: 'available' }]);
      },
    );

    specify(
      'should leave a step untouched when nothing applicable remains to inherit',
      async function () {
        const [step] = await inherit([{ name: 'petId', value: '7' }], { stepId: 'a' });

        assert.isUndefined(step);
      },
    );

    specify(
      "should still collapse a step's own duplicates when nothing applicable remains",
      async function () {
        // whether a step's own duplicate (name, in) entries collapse must not
        // depend on the unrelated question of what the workflow happened to
        // contribute to that kind of step.
        const [step] = await inherit([{ name: 'petId', value: '7' }], {
          stepId: 'a',
          parameters: [
            { name: 'q', in: 'query', value: 1 },
            { name: 'q', in: 'query', value: 2 },
          ],
        });

        assert.deepEqual(step, [{ name: 'q', in: 'query', value: 1 }]);
      },
    );

    specify('should treat an explicitly null location as absent', async function () {
      // `in:` with an empty value (a YAML null) says "no location" the same
      // way omitting the field does — an input-shaped parameter, inherited
      // only into workflowId steps, not a malformed location that would fail
      // an operation step's run.
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'petId', in: null, value: '7' }],
        steps: [{ stepId: 'a', operationId: 'getInventory' }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.isUndefined((toValue(normalized.steps) as { parameters?: unknown }[])[0].parameters);
    });

    specify('should inherit an input-shaped parameter into a workflowId step', async function () {
      // for a step targeting a workflowId, "all parameters map to workflow
      // inputs" — the input-shaped parameter is exactly what such a step
      // consumes.
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'petId', value: '7' }],
        steps: [{ stepId: 'a', workflowId: 'other' }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.deepEqual((toValue(normalized.steps) as { parameters?: unknown }[])[0].parameters, [
        { name: 'petId', value: '7' },
      ]);
    });

    specify('should still inherit a malformed location into an operation step', async function () {
      // `in: 1` is not a location, but unlike an absent one it is an
      // authoring error — carried across so the resolver reports it loudly
      // rather than erased here, which would leave nothing to report.
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'x', in: 1, value: 'v' }],
        steps: [{ stepId: 'a', operationId: 'getInventory' }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.deepEqual((toValue(normalized.steps) as { parameters?: unknown }[])[0].parameters, [
        { name: 'x', in: 1, value: 'v' },
      ]);
    });

    specify('should carry a non-Parameter entry across untouched', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        steps: [{ stepId: 'a', operationId: 'getInventory', parameters: ['not-a-parameter'] }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      // rebuilding the step's list is no licence to drop what its author wrote,
      // however malformed — two such entries are not "equal" to each other.
      assert.deepEqual((toValue(normalized.steps) as { parameters: unknown }[])[0].parameters, [
        'not-a-parameter',
        { name: 'status', in: 'query', value: 'available' },
      ]);
    });

    specify('should not collapse two entries that both lack a name', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        steps: [
          {
            stepId: 'a',
            operationId: 'getInventory',
            parameters: [
              { in: 'query', value: 1 },
              { in: 'query', value: 2 },
            ],
          },
        ],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.lengthOf((toValue(normalized.steps) as { parameters: unknown[] }[])[0].parameters, 3);
    });

    specify('should not collapse two entries whose location is not a string', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        steps: [
          {
            stepId: 'a',
            operationId: 'getInventory',
            // `in: 1` is not a location, so these are no more "the same
            // parameter" than two unnamed entries are.
            parameters: [
              { name: 'x', in: 1, value: 'first' },
              { name: 'x', in: 1, value: 'second' },
            ],
          },
        ],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.lengthOf((toValue(normalized.steps) as { parameters: unknown[] }[])[0].parameters, 3);
    });

    specify('should skip a step whose own parameters is present but not a list', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        steps: [{ stepId: 'a', operationId: 'getInventory', parameters: 'not-a-list' }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      // overwriting it would erase the very thing that makes the document
      // invalid, leaving the executor nothing to report.
      assert.strictEqual(
        (toValue(normalized.steps) as { parameters: unknown }[])[0].parameters,
        'not-a-list',
      );
    });

    specify('should match names case-sensitively, per the specification', async function () {
      const [step] = await inherit([{ name: 'Status', in: 'query', value: 'pending' }], {
        stepId: 'a',
        parameters: [{ name: 'status', in: 'query', value: 'sold' }],
      });

      assert.lengthOf(step!, 2);
    });

    specify('should leave steps untouched when the workflow declares none', async function () {
      const steps = await inherit(
        undefined,
        { stepId: 'a', parameters: [{ name: 'status', in: 'query', value: 'sold' }] },
        { stepId: 'b' },
      );

      assert.deepEqual(steps[0], [{ name: 'status', in: 'query', value: 'sold' }]);
      // a step declaring none is not given an empty list it never had.
      assert.isUndefined(steps[1]);
    });

    specify(
      'should be idempotent, so a cached workflow is not re-inherited into',
      async function () {
        const workflow = refractWorkflow({
          workflowId: 'w',
          parameters: [{ name: 'status', in: 'query', value: 'available' }],
          steps: [
            {
              stepId: 'a',
              operationId: 'getInventory',
              parameters: [{ name: 'limit', in: 'query', value: 10 }],
            },
          ],
        }) as WorkflowElement;

        await normalizer.normalize(workflow, entryDoc);
        const normalized = await normalizer.normalize(workflow, entryDoc);

        assert.deepEqual((toValue(normalized.steps) as { parameters: unknown }[])[0].parameters, [
          { name: 'limit', in: 'query', value: 10 },
          { name: 'status', in: 'query', value: 'available' },
        ]);
      },
    );

    specify('should leave a malformed steps for the executor to report', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        parameters: [{ name: 'status', in: 'query', value: 'available' }],
        steps: 'not-a-list',
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.strictEqual(toValue(normalized.steps), 'not-a-list');
    });
  });

  context('action inheritance', function () {
    let entryDoc: ArazzoDocument;

    before(async function () {
      const registry = new DocumentRegistry();
      entryDoc = await registry.acquireEntryDocument(fixturePath);
    });

    type ActionEntry = Record<string, unknown>;
    type StepEntry = { stepId: string; onSuccess?: unknown; onFailure?: unknown };
    type NormalizedStep = { onSuccess?: ActionEntry[]; onFailure?: ActionEntry[] };

    /**
     * Normalizes a workflow built from plain values, returning the action lists
     * its steps end up with — one entry per step, in step order.
     */
    const inherit = async (
      actions: { successActions?: unknown; failureActions?: unknown },
      ...steps: StepEntry[]
    ): Promise<NormalizedStep[]> => {
      const workflow = refractWorkflow({
        workflowId: 'w',
        ...actions,
        steps: steps.map((step) => ({ operationId: 'getInventory', ...step })),
      }) as WorkflowElement;
      const normalized = await normalizer.normalize(workflow, entryDoc);

      return toValue(normalized.steps) as NormalizedStep[];
    };

    const retryOrder: ActionEntry = { name: 'retryOrder', type: 'retry', retryAfter: 1 };
    const endRun: ActionEntry = { name: 'endRun', type: 'end' };

    specify(
      'should inherit successActions into a step that declares no onSuccess',
      async function () {
        const [step] = await inherit({ successActions: [endRun] }, { stepId: 'a' });

        assert.deepEqual(step.onSuccess, [endRun]);
      },
    );

    specify(
      'should inherit failureActions into a step that declares no onFailure',
      async function () {
        const [step] = await inherit({ failureActions: [retryOrder] }, { stepId: 'a' });

        assert.deepEqual(step.onFailure, [retryOrder]);
      },
    );

    specify('should inherit into every step of the workflow', async function () {
      const steps = await inherit({ successActions: [endRun] }, { stepId: 'a' }, { stepId: 'b' });

      assert.deepEqual(steps[0].onSuccess, [endRun]);
      assert.deepEqual(steps[1].onSuccess, [endRun]);
    });

    specify("should let a step's own list override wholesale, with no merge", async function () {
      const own = { name: 'ownEnd', type: 'end' };
      const [step] = await inherit({ successActions: [endRun] }, { stepId: 'a', onSuccess: [own] });

      // unlike parameters, which merge, an action list replaces the workflow's
      // outright — nothing of the workflow's survives alongside it.
      assert.deepEqual(step.onSuccess, [own]);
    });

    specify('should keep an empty list a step declares, without falling back', async function () {
      const [step] = await inherit({ successActions: [endRun] }, { stepId: 'a', onSuccess: [] });

      // `onSuccess: []` overrides the default with an empty set of actions; it
      // does not ask for one.
      assert.deepEqual(step.onSuccess, []);
    });

    specify('should fall back to success and failure independently', async function () {
      const own = { name: 'ownRetry', type: 'retry', retryAfter: 2 };
      const [step] = await inherit(
        { successActions: [endRun], failureActions: [retryOrder] },
        { stepId: 'a', onFailure: [own] },
      );

      assert.deepEqual(step.onFailure, [own]);
      assert.deepEqual(step.onSuccess, [endRun]);
    });

    specify('should inherit into a workflowId step too', async function () {
      // unlike parameters there is no step-kind filter: an action names a
      // transition within the workflow, which is as meaningful for a step
      // targeting a workflowId as for one invoking an operation. This is the
      // path the workflow executor serves through `selectActions`.
      const workflow = refractWorkflow({
        workflowId: 'w',
        successActions: [endRun],
        steps: [{ stepId: 'a', workflowId: 'other' }],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.deepEqual((toValue(normalized.steps) as NormalizedStep[])[0].onSuccess, [endRun]);
    });

    specify('should leave steps untouched when the workflow declares none', async function () {
      const [step] = await inherit({}, { stepId: 'a' });

      assert.isUndefined(step.onSuccess);
      assert.isUndefined(step.onFailure);
    });

    specify('should not synthesize a list from an empty workflow list', async function () {
      const [step] = await inherit({ successActions: [] }, { stepId: 'a' });

      // an empty default is what declaring nothing already means; synthesizing
      // it would only move the document further from its source.
      assert.isUndefined(step.onSuccess);
    });

    specify('should skip a step whose own onSuccess is present but not a list', async function () {
      const [step] = await inherit({ successActions: [endRun] }, {
        stepId: 'a',
        onSuccess: 'not-a-list',
      } as StepEntry);

      // overwriting it would erase the very thing that makes the document
      // invalid; it reaches the executor as written. (What the executor then
      // does with it is a raw TypeError out of `ActionResolver` rather than an
      // `ExecutionError` naming the step — long-standing, and true of a
      // malformed `parameters` too, so not settled here.)
      assert.strictEqual(step.onSuccess as unknown, 'not-a-list');
    });

    specify(
      'should be idempotent, so a cached workflow is not re-inherited into',
      async function () {
        const workflow = refractWorkflow({
          workflowId: 'w',
          successActions: [endRun],
          steps: [{ stepId: 'a', operationId: 'getInventory' }],
        }) as WorkflowElement;

        await normalizer.normalize(workflow, entryDoc);
        const normalized = await normalizer.normalize(workflow, entryDoc);

        // the second pass sees a step that now has the key, and leaves it alone.
        assert.deepEqual((toValue(normalized.steps) as NormalizedStep[])[0].onSuccess, [endRun]);
      },
    );

    specify('should share the workflow action elements with every step', async function () {
      // retry budgets are keyed by action element identity, so what each step
      // inherits must be the same instances every falling-back step shared
      // before — a copied list of the same elements, not re-refracted clones.
      const workflow = refractWorkflow({
        workflowId: 'w',
        failureActions: [retryOrder],
        steps: [
          { stepId: 'a', operationId: 'getInventory' },
          { stepId: 'b', operationId: 'getInventory' },
        ],
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      const [a, b] = [...normalized.steps!] as StepElement[];
      assert.strictEqual([...a.onFailure!][0], [...b.onFailure!][0]);
      assert.strictEqual([...a.onFailure!][0], [...normalized.failureActions!][0]);
    });

    specify('should leave a malformed steps list alone', async function () {
      const workflow = refractWorkflow({
        workflowId: 'w',
        successActions: [endRun],
        steps: 'not-a-list',
      }) as WorkflowElement;

      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.strictEqual(toValue(normalized.steps), 'not-a-list');
    });
  });

  context('given Arazzo document with component references', function () {
    specify('should dereference component references', async function () {
      const registry = new DocumentRegistry();
      const entryDoc = await registry.acquireEntryDocument(componentFixturePath);
      const workflow = extractor.extract(entryDoc, 'testWorkflow');
      const normalized = await normalizer.normalize(workflow, entryDoc);

      assert.isTrue(isWorkflowElement(normalized));
      const steps = toValue(normalized.steps) as Record<string, unknown>[];
      assert.isArray(steps);
      assert.isAbove(steps.length, 0);
      const firstStep = steps[0];
      const parameters = firstStep.parameters as Record<string, unknown>[];
      assert.isArray(parameters);
      assert.strictEqual(parameters[0].name, 'petId');
    });

    specify('should inherit a referenced workflow action list already inlined', async function () {
      const registry = new DocumentRegistry();
      const entryDoc = await registry.acquireEntryDocument(componentFixturePath);
      const workflow = extractor.extract(entryDoc, 'testWorkflow');
      const normalized = await normalizer.normalize(workflow, entryDoc);

      // inheritance runs after dereferencing, so what reaches the step is the
      // resolved Success Action Object, never the Reusable Object it was
      // written as — the property `ActionResolver` relies on.
      const steps = toValue(normalized.steps) as Record<string, unknown>[];
      assert.deepEqual(steps[0].onSuccess, [{ name: 'finish', type: 'end' }]);
    });
  });
});
