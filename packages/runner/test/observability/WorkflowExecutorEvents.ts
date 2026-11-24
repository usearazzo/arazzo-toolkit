import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { toValue } from '@speclynx/apidom-core';

import {
  DocumentRegistry,
  ArazzoDocument,
  ExecutionError,
  WorkflowExecutor,
  StepExecutor,
  OpenAPIOperationExecutor,
  type ArazzoRunnerObserver,
  type CriterionEvaluationRecord,
  type HTTPClient,
  type RetryReferenceRecord,
  type SelectedAction,
  type StepRunRecord,
  type WorkflowExecutionEvent,
  type WorkflowExecutionResult,
  type WorkflowStartEvent,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
// every input any fixture workflow reads; unread ones are ignored.
const inputs = { status: 'available', value: 'x', petId: 7, seed: 1 };
const controlFlowPath = path.join(fixturesPath, 'workflow-control-flow.arazzo.yaml');
const compositionPath = path.join(fixturesPath, 'workflow-composition.arazzo.yaml');
const crossDocumentPath = path.join(fixturesPath, 'cross-document.arazzo.yaml');

type CannedStatus = 200 | 500 | 503;

interface StepBuilder {
  readonly stepId: string;
  readonly location: StepRunRecord['location'];
  readonly startedAt: number;
  successCriteria: CriterionEvaluationRecord[];
  actionCriteria: CriterionEvaluationRecord[];
  action: SelectedAction | undefined;
  readonly subWorkflows: WorkflowExecutionResult[];
  readonly retryReferences: RetryReferenceRecord[];
}

interface ReferenceBuilder {
  readonly kind: RetryReferenceRecord['kind'];
  readonly id: string;
  subWorkflow?: WorkflowExecutionResult;
}

interface WorkflowFrame {
  readonly start: WorkflowStartEvent;
  readonly steps: StepRunRecord[];
  readonly dependencies: WorkflowExecutionResult[];
  step?: StepBuilder | undefined;
  reference?: ReferenceBuilder | undefined;
  dependencyRun?: WorkflowExecutionResult | undefined;
  transferredTo?: WorkflowExecutionResult;
}

/**
 * Rebuilds a run's trace from its workflow events alone — the invariant the
 * event vocabulary is held to. Memoized dependencies are looked up by the
 * workflow they resolved to, as the executor's own ledger does.
 */
const fold = (events: readonly WorkflowExecutionEvent[]): WorkflowExecutionResult => {
  const stack: WorkflowFrame[] = [];
  const completedDependencies = new Map<string, WorkflowExecutionResult>();
  let root: WorkflowExecutionResult | undefined;
  const top = (): WorkflowFrame => stack[stack.length - 1];

  for (const event of events) {
    switch (event.type) {
      case 'workflow:start':
        stack.push({ start: event, steps: [], dependencies: [] });
        break;
      case 'workflow:settled': {
        const frame = stack.pop() as WorkflowFrame;
        const result: WorkflowExecutionResult = {
          workflowId: event.workflowId,
          outputs: event.outputs,
          steps: frame.steps,
          status: event.status,
          settledStatus: event.settledStatus,
          durationMs: event.timestamp - frame.start.timestamp,
          ...(frame.dependencies.length > 0 ? { dependencies: frame.dependencies } : {}),
          ...(frame.transferredTo === undefined ? {} : { transferredTo: frame.transferredTo }),
        };
        const parent = stack[stack.length - 1];
        switch (frame.start.via) {
          case 'root':
            root = result;
            break;
          case 'dependsOn':
            parent.dependencyRun = result;
            break;
          case 'goto':
            parent.transferredTo = result;
            break;
          case 'retry':
            (parent.reference as ReferenceBuilder).subWorkflow = result;
            break;
          case 'step':
            if (parent.reference !== undefined) parent.reference.subWorkflow ??= result;
            else parent.step?.subWorkflows.push(result);
            break;
        }
        break;
      }
      case 'dependency:settled': {
        const frame = top();
        const key = `${event.dependency.documentURI}#${event.dependency.workflowId}`;
        const result = event.memoized
          ? (completedDependencies.get(key) as WorkflowExecutionResult)
          : (frame.dependencyRun as WorkflowExecutionResult);
        frame.dependencies.push(result);
        if (!event.memoized && event.settledStatus !== 'failed') {
          completedDependencies.set(key, result);
        }
        frame.dependencyRun = undefined;
        break;
      }
      case 'step:start':
        top().step = {
          stepId: event.stepId,
          location: event.location,
          startedAt: event.timestamp,
          successCriteria: [],
          actionCriteria: [],
          action: undefined,
          subWorkflows: [],
          retryReferences: [],
        };
        break;
      case 'step:attempt': {
        const frame = top();
        // a referenced step's attempt belongs to the reference, which the
        // trace records without criteria.
        if (frame.reference !== undefined) break;
        const step = frame.step as StepBuilder;
        step.successCriteria = [];
        step.actionCriteria = [];
        break;
      }
      case 'criterion:evaluated': {
        const frame = top();
        if (frame.reference !== undefined) break;
        const step = frame.step as StepBuilder;
        if (event.kind === 'success') step.successCriteria.push(event.criterion);
        else step.actionCriteria.push(event.criterion);
        break;
      }
      case 'action:selected':
        (top().step as StepBuilder).action = event.action;
        break;
      case 'retry:reference:start':
        top().reference = { kind: event.kind, id: event.id };
        break;
      case 'retry:reference:settled': {
        const frame = top();
        const reference = frame.reference as ReferenceBuilder;
        (frame.step as StepBuilder).retryReferences.push({
          kind: reference.kind,
          id: reference.id,
          successful: event.successful,
          ...(reference.subWorkflow === undefined ? {} : { subWorkflow: reference.subWorkflow }),
        });
        frame.reference = undefined;
        break;
      }
      case 'step:settled': {
        const frame = top();
        const step = frame.step as StepBuilder;
        frame.steps.push({
          stepId: step.stepId,
          location: step.location,
          successful: event.successful,
          action: step.action,
          attempts: event.attempts,
          durationMs: event.timestamp - step.startedAt,
          successCriteria: step.successCriteria,
          actionCriteria: step.actionCriteria,
          ...(step.subWorkflows.length > 0 ? { subWorkflows: step.subWorkflows } : {}),
          ...(step.retryReferences.length > 0 ? { retryReferences: step.retryReferences } : {}),
        });
        frame.step = undefined;
        break;
      }
      default:
        break;
    }
  }

  assert.lengthOf(stack, 0, 'every workflow:start has its workflow:settled');
  return root as WorkflowExecutionResult;
};

/**
 * Every result in a trace, the root included, for asserting that a set of
 * runs exercised a control-flow feature at all.
 */
const allResults = (result: WorkflowExecutionResult): WorkflowExecutionResult[] => [
  result,
  ...(result.dependencies ?? []).flatMap(allResults),
  ...(result.transferredTo === undefined ? [] : allResults(result.transferredTo)),
  ...result.steps.flatMap((step) => [
    ...(step.subWorkflows ?? []).flatMap(allResults),
    ...(step.retryReferences ?? []).flatMap((reference) =>
      reference.subWorkflow === undefined ? [] : allResults(reference.subWorkflow),
    ),
  ]),
];

describe('WorkflowExecutor events', function () {
  let registry: DocumentRegistry;
  let controlFlow: ArazzoDocument;
  let composition: ArazzoDocument;
  let crossDocument: ArazzoDocument;
  const documents = (): Record<string, ArazzoDocument> => ({
    'control-flow': controlFlow,
    composition,
    'cross-document': crossDocument,
  });

  before(async function () {
    registry = new DocumentRegistry();
    controlFlow = await registry.acquireEntryDocument(controlFlowPath);
    const acquire = async (uri: string): Promise<ArazzoDocument> => {
      const document = await registry.acquire(uri);
      assert.isTrue(ArazzoDocument.is(document));
      return document as ArazzoDocument;
    };
    composition = await acquire(compositionPath);
    crossDocument = await acquire(crossDocumentPath);
  });

  /**
   * Builds an executor over `document` whose transport answers with
   * `statuses` in order (repeating the last), on a fake clock that advances
   * 10ms per request and by every retry wait.
   */
  const makeExecutor = (
    document: ArazzoDocument,
    statuses: readonly CannedStatus[],
    observer?: ArazzoRunnerObserver<WorkflowExecutionEvent>,
  ): { executor: WorkflowExecutor; calls: () => number } => {
    let time = 0;
    let calls = 0;
    const httpClient: HTTPClient = async () => {
      const status = statuses[Math.min(calls, statuses.length - 1)];
      calls += 1;
      time += 10;
      return new Response(JSON.stringify(status === 200 ? { id: 7, name: 'Rex' } : {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    };
    const executor = new WorkflowExecutor({
      document,
      registry,
      stepExecutor: new StepExecutor({
        document,
        registry,
        operationExecutor: new OpenAPIOperationExecutor({ httpClient }),
      }),
      sleep: async (ms) => {
        time += ms;
      },
      now: () => time,
      observer,
    });
    return { executor, calls: () => calls };
  };

  const record = async (
    document: ArazzoDocument,
    workflowId: string,
    statuses: readonly CannedStatus[],
  ): Promise<{ result: WorkflowExecutionResult; events: WorkflowExecutionEvent[] }> => {
    const events: WorkflowExecutionEvent[] = [];
    const { executor } = makeExecutor(document, statuses, (event) => events.push(event));
    const result = await executor.execute(workflowId, { inputs });
    return { result, events };
  };

  // workflows covering every control-flow path, each under the response
  // sequences that drive it down its branches.
  const runs: readonly [string, string, readonly CannedStatus[]][] = [
    ['control-flow', 'linear', [200]],
    ['control-flow', 'gotoStep', [200]],
    ['control-flow', 'endEarly', [200]],
    ['control-flow', 'failBreak', [500]],
    ['control-flow', 'transfersToTarget', [200]],
    ['control-flow', 'transferChainStart', [200]],
    ['control-flow', 'transferOnFailure', [500]],
    ['control-flow', 'transfersToFailing', [200, 500]],
    ['control-flow', 'retryThenSucceed', [503, 503, 200]],
    ['control-flow', 'retryThenSucceedThenNext', [503, 200]],
    ['control-flow', 'retryExhaustedThenEnd', [503]],
    ['control-flow', 'retryExhaustedThenBreak', [503]],
    ['control-flow', 'retryChainIndependentBudgets', [503]],
    ['control-flow', 'retryExhaustedThenGoto', [503]],
    ['control-flow', 'retryWithRepairStep', [503, 200]],
    ['control-flow', 'retryWithWorkflowReference', [503, 200]],
    ['control-flow', 'repairFeedsSubWorkflowStep', [503, 200]],
    ['control-flow', 'inheritedRetryPerStepBudget', [503]],
    ['composition', 'callsChild', [200]],
    ['composition', 'callsChildTwice', [200]],
    ['composition', 'childCriteriaFail', [200]],
    ['composition', 'retriesChild', [500]],
    ['composition', 'diamondTop', [200]],
    ['composition', 'depDiamondTop', [200]],
    ['composition', 'dependsOnFailing', [500]],
    ['composition', 'dependsOnTransferringPrereq', [200]],
    ['composition', 'dependent', [200]],
    ['composition', 'deepOne', [200]],
    ['cross-document', 'crossDocumentStep', [200]],
    ['cross-document', 'crossDocumentDependsOn', [200]],
    ['cross-document', 'crossDocumentRetryStepInside', [500, 200]],
    ['cross-document', 'crossDocumentRetryReference', [500, 200]],
    ['cross-document', 'crossDocumentGoto', [200]],
    ['cross-document', 'crossDocumentGotoWithDeps', [200]],
    ['cross-document', 'collisionCaller', [200]],
    ['cross-document', 'deepEntry', [200]],
  ];

  context('fold', function () {
    runs.forEach(([fixture, workflowId, statuses]) => {
      specify(`should rebuild the trace of ${fixture} "${workflowId}"`, async function () {
        const document = documents()[fixture];
        const { result, events } = await record(document, workflowId, statuses);

        assert.deepEqual(fold(events), result);
      });
    });

    specify('should cover every control-flow feature the trace records', async function () {
      const results: WorkflowExecutionResult[] = [];
      for (const [fixture, workflowId, statuses] of runs) {
        const document = documents()[fixture];
        results.push(...allResults((await record(document, workflowId, statuses)).result));
      }
      const steps = results.flatMap((result) => result.steps);

      assert.isTrue(
        steps.some((step) => step.attempts > 1),
        'retries',
      );
      assert.isTrue(
        steps.some((step) => (step.subWorkflows?.length ?? 0) > 1),
        'sub-workflows',
      );
      assert.isTrue(
        steps.some((step) => step.retryReferences?.some((ref) => ref.kind === 'step')),
        'step retry references',
      );
      assert.isTrue(
        steps.some((step) => step.retryReferences?.some((ref) => ref.kind === 'workflow')),
        'workflow retry references',
      );
      assert.isTrue(
        results.some((result) => result.transferredTo !== undefined),
        'transfers',
      );
      assert.isTrue(
        results.some((result) => (result.dependencies?.length ?? 0) > 0),
        'dependencies',
      );
      assert.isTrue(
        results.some((result) => result.status === 'ended'),
        'end actions',
      );
    });
  });

  context('vocabulary', function () {
    specify('should explain a retry chain through its decisions', async function () {
      const { result, events } = await record(controlFlow, 'retryThenSucceed', [503, 503, 200]);

      const decisions = events
        .filter((event) => event.type === 'step:attempt' || event.type === 'action:selected')
        .map((event) =>
          event.type === 'step:attempt'
            ? `attempt ${event.attempt}`
            : `${event.attempt}: ${event.action === undefined ? 'default' : toValue(event.action.type)} -> ${event.transition.kind}`,
        );
      assert.deepEqual(decisions, [
        'attempt 1',
        '1: retry -> retry',
        'attempt 2',
        '2: retry -> retry',
        'attempt 3',
        '3: default -> next',
      ]);
      assert.strictEqual(result.steps[0].attempts, 3);
    });

    specify('should say where each step went, default path included', async function () {
      const transitions = async (
        document: ArazzoDocument,
        workflowId: string,
        statuses: readonly CannedStatus[],
      ): Promise<unknown[]> => {
        const { events } = await record(document, workflowId, statuses);
        return events.flatMap((event) =>
          event.type === 'action:selected' && event.workflowId === workflowId
            ? [event.transition]
            : [],
        );
      };

      assert.deepEqual(await transitions(controlFlow, 'failBreak', [500]), [{ kind: 'break' }]);
      assert.deepEqual(await transitions(controlFlow, 'transfersToTarget', [200]), [
        { kind: 'transfer', workflowId: 'transferTarget' },
      ]);
      assert.deepInclude(await transitions(controlFlow, 'gotoStep', [200]), {
        kind: 'goto',
        stepId: 'third',
      });
    });

    specify('should mark a memoized dependency', async function () {
      const { events } = await record(composition, 'depDiamondTop', [200]);

      const settled = events.flatMap((event) =>
        event.type === 'dependency:settled'
          ? [`${event.dependency.reference} ${event.memoized}`]
          : [],
      );
      // setupA runs under depDiamondLeft and is reused under depDiamondRight.
      assert.deepEqual(settled, [
        'setupA false',
        'depDiamondLeft false',
        'setupA true',
        'depDiamondRight false',
      ]);
    });

    specify('should tell concurrent runs apart by runId', async function () {
      const events: WorkflowExecutionEvent[] = [];
      const { executor } = makeExecutor(controlFlow, [200], (event) => events.push(event));

      await Promise.all([
        executor.execute('linear', { inputs }),
        executor.execute('linear', { inputs }),
      ]);

      const runIds = [...new Set(events.map((event) => event.runId))];
      assert.lengthOf(runIds, 2);
      for (const runId of runIds) {
        const run = events.filter((event) => event.runId === runId);
        assert.strictEqual(fold(run).status, 'completed');
      }
    });

    specify('should name a foreign workflow by its document in the path', async function () {
      const { events } = await record(crossDocument, 'crossDocumentStep', [200]);

      const foreign = events.find(
        (event) => event.type === 'workflow:start' && event.via === 'step',
      );
      assert.lengthOf(foreign?.path ?? [], 2);
      assert.strictEqual(foreign?.path[0], 'crossDocumentStep');
      assert.match(foreign?.path[1] ?? '', /cross-document-child\.arazzo\.yaml#childFetch$/);
    });

    specify(
      'should settle the open step and workflow of a cancelled run with the error',
      async function () {
        const events: WorkflowExecutionEvent[] = [];
        const controller = new AbortController();
        const executor = new WorkflowExecutor({
          document: controlFlow,
          registry,
          stepExecutor: new StepExecutor({
            document: controlFlow,
            registry,
            operationExecutor: new OpenAPIOperationExecutor({
              httpClient: async () => {
                controller.abort();
                return new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                });
              },
            }),
          }),
          observer: (event) => events.push(event),
        });

        let caught: unknown;
        try {
          await executor.execute('linear', { inputs, signal: controller.signal });
        } catch (error) {
          caught = error;
        }

        assert.instanceOf(caught, ExecutionError);
        // the step in flight settles as it would, the next stops at its
        // boundary, and both it and the workflow settle with the abort.
        const settled = events.filter(
          (event) => event.type === 'step:settled' || event.type === 'workflow:settled',
        );
        assert.deepEqual(
          settled.map((event) => [event.type, 'error' in event ? event.error : undefined]),
          [
            ['step:settled', undefined],
            ['step:settled', caught],
            ['workflow:settled', caught],
          ],
        );
        assert.notProperty(settled[0], 'error');
        // stopped at its boundary, before its first attempt ran
        assert.include(settled.at(-2), { successful: false, attempts: 0 });
        assert.include(settled.at(-1), { status: 'failed', settledStatus: 'failed' });
      },
    );

    specify('should settle every workflow and step a throwing transport leaves', async function () {
      const thrown = new TypeError('fetch failed');
      const events: WorkflowExecutionEvent[] = [];
      const executor = new WorkflowExecutor({
        document: composition,
        registry,
        stepExecutor: new StepExecutor({
          document: composition,
          registry,
          operationExecutor: new OpenAPIOperationExecutor({
            httpClient: async () => {
              throw thrown;
            },
          }),
        }),
        observer: (event) => events.push(event),
      });

      let caught: unknown;
      try {
        await executor.execute('callsChild', { inputs });
      } catch (error) {
        caught = error;
      }

      // the transport's error, as the operation executor wraps it.
      assert.strictEqual((caught as Error).cause, thrown);
      // the child's step, the child, the parent's step and the parent, innermost first.
      const settled = events.filter(
        (event) => event.type === 'step:settled' || event.type === 'workflow:settled',
      );
      assert.deepEqual(
        settled.map((event) => [event.type, event.path.length]),
        [
          ['step:settled', 2],
          ['workflow:settled', 2],
          ['step:settled', 1],
          ['workflow:settled', 1],
        ],
      );
      assert.isTrue(settled.every((event) => event.error === caught));
      const starts = events.filter(
        (event) => event.type === 'step:start' || event.type === 'workflow:start',
      );
      assert.lengthOf(starts, settled.length);
    });

    specify('should tag every event with the path of the workflows in progress', async function () {
      const { events } = await record(composition, 'callsChild', [200]);

      const child = events.find(
        (event) => event.type === 'workflow:start' && event.workflowId === 'fetchPet',
      );
      assert.deepEqual(child?.path, ['callsChild', 'fetchPet']);
      assert.isTrue(events.every((event) => event.path[0] === 'callsChild'));
    });

    specify('should emit workflow normalization once per workflow', async function () {
      const { events } = await record(composition, 'callsChildTwice', [200]);

      const debug = events.filter((event) => event.type.startsWith('workflow:normalize:'));
      assert.deepEqual(
        debug.map((event) => `${event.type} ${event.workflowId}`),
        [
          'workflow:normalize:start callsChildTwice',
          'workflow:normalize:settled callsChildTwice',
          'workflow:normalize:start fetchPet',
          'workflow:normalize:settled fetchPet',
        ],
      );
    });
  });

  context('non-interference', function () {
    specify('should hand out frozen copies of what the run keeps', async function () {
      const { result, events } = await record(controlFlow, 'linear', [200]);
      const find = <T extends WorkflowExecutionEvent['type']>(
        type: T,
      ): Extract<WorkflowExecutionEvent, { type: T }> =>
        events.find((event) => event.type === type) as Extract<WorkflowExecutionEvent, { type: T }>;

      const settled = find('workflow:settled');
      assert.isTrue(Object.isFrozen(settled));
      assert.isTrue(Object.isFrozen(settled.outputs));
      assert.isTrue(Object.isFrozen(settled.path));
      assert.notStrictEqual(settled.outputs, result.outputs);
      assert.deepEqual(settled.outputs, result.outputs);
      assert.isFalse(Object.isFrozen(result.outputs));

      const criterion = find('criterion:evaluated').criterion;
      assert.isTrue(Object.isFrozen(criterion));
      assert.notStrictEqual(criterion, result.steps[0].successCriteria[0]);
      assert.isTrue(Object.isFrozen(find('action:selected').transition));
    });

    specify('should abort the run when an observer changes an event', async function () {
      const { executor } = makeExecutor(controlFlow, [200], (event) => {
        if (event.type === 'workflow:settled') {
          (event.outputs as Record<string, unknown>).name = 'Tampered';
        }
      });

      let caught: unknown;
      try {
        await executor.execute('linear', { inputs });
      } catch (error) {
        caught = error;
      }

      assert.instanceOf(caught, TypeError);
    });

    specify('should not change the result', async function () {
      const observed = await record(controlFlow, 'retryWithWorkflowReference', [503, 200]);
      const { executor } = makeExecutor(controlFlow, [503, 200]);
      const unobserved = await executor.execute('retryWithWorkflowReference', { inputs });

      assert.deepEqual(observed.result, unobserved);
    });

    specify('should not await what the observer returns', async function () {
      const { executor } = makeExecutor(
        controlFlow,
        [200],
        (() => new Promise(() => {})) as unknown as ArazzoRunnerObserver<WorkflowExecutionEvent>,
      );

      const result = await executor.execute('linear', { inputs });

      assert.strictEqual(result.status, 'completed');
    });

    specify('should abort the run with the error an observer throws', async function () {
      const thrown = new Error('observer bug');
      const { executor, calls } = makeExecutor(controlFlow, [200], (event) => {
        if (event.type === 'step:start') throw thrown;
      });

      let caught: unknown;
      try {
        await executor.execute('linear', { inputs });
      } catch (error) {
        caught = error;
      }

      assert.strictEqual(caught, thrown);
      assert.strictEqual(calls(), 0);
    });
  });
});
