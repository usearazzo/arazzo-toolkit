import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  ArazzoRunner,
  DocumentLoadError,
  type ArazzoRunnerEvent,
  type ArazzoRunnerLoadOptions,
  type DocumentLocation,
  type HTTPClient,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(__dirname, '..', 'fixtures');
const fixture = (file: string): string => path.join(fixturesPath, file);

const respond =
  (status: number): HTTPClient =>
  async () =>
    new Response(JSON.stringify({ id: 7, name: 'Rex' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

const run = async (
  file: string,
  workflowId: string,
  options: ArazzoRunnerLoadOptions = {},
): Promise<ArazzoRunnerEvent[]> => {
  const events: ArazzoRunnerEvent[] = [];
  const runner = await ArazzoRunner.load(fixture(file), {
    httpClient: respond(200),
    ...options,
    observer: (event) => events.push(event),
  });
  await runner.execute(workflowId, { inputs: { status: 'available' } });
  return events;
};

const locationsOf = (events: ArazzoRunnerEvent[], type: ArazzoRunnerEvent['type']) =>
  events
    .filter((event) => event.type === type)
    .map((event) => (event as { location?: DocumentLocation }).location);

describe('Document locations', function () {
  const components = 'arazzo-with-components/workflow.arazzo.yaml';

  specify('should locate workflows, steps and actions with source maps', async function () {
    const events = await run(components, 'testWorkflow', { sourceMap: true });
    const uri = fixture(components);

    assert.deepEqual(locationsOf(events, 'workflow-start'), [
      { uri, jsonPointer: '/workflows/0', line: 10, column: 5 },
    ]);
    assert.deepEqual(locationsOf(events, 'workflow-normalize-start'), [
      { uri, jsonPointer: '/workflows/0', line: 10, column: 5 },
    ]);
    assert.deepEqual(locationsOf(events, 'step-start'), [
      { uri, jsonPointer: '/workflows/0/steps/0', line: 15, column: 9 },
    ]);
    // a workflow-level action reached through $components: where it is defined
    assert.deepEqual(locationsOf(events, 'action-selected'), [
      { uri, jsonPointer: '/components/successActions/finish', line: 42, column: 7 },
    ]);
  });

  specify('should locate by JSON Pointer alone without source maps', async function () {
    const events = await run(components, 'testWorkflow');

    assert.deepEqual(locationsOf(events, 'step-start'), [
      { uri: fixture(components), jsonPointer: '/workflows/0/steps/0' },
    ]);
  });

  specify('should locate an OpenAPI operation in its own document', async function () {
    const events = await run(components, 'testWorkflow', { sourceMap: true });

    const [location] = locationsOf(events, 'openapi-operation-request-start');
    assert.deepInclude(location, {
      uri: fixture('petstore.openapi.json'),
      jsonPointer: '/paths/~1pet~1{petId}/get',
    });
    assert.isAbove(location?.line ?? 0, 1);
    assert.deepEqual(locationsOf(events, 'openapi-operation-request-settled'), [location]);
  });

  specify('should locate an operation of a $ref path item in the file it names', async function () {
    const events = await run('external-pathitem/workflow.arazzo.yaml', 'testWorkflow', {
      sourceMap: true,
    });

    assert.deepEqual(locationsOf(events, 'openapi-operation-request-start'), [
      {
        uri: fixture('external-pathitem/paths/pets.json'),
        jsonPointer: '/get',
        line: 2,
        column: 10,
      },
    ]);
  });

  specify(
    'should locate an inherited action and a criterion where each is written',
    async function () {
      const events = await run('workflow-control-flow.arazzo.yaml', 'inheritsFailureActions', {
        sourceMap: true,
        httpClient: respond(500),
      });
      const uri = fixture('workflow-control-flow.arazzo.yaml');

      const [criterion] = locationsOf(events, 'criterion-evaluated');
      assert.deepInclude(criterion, { uri, line: 642, column: 13 });
      assert.match(
        criterion?.jsonPointer ?? '',
        /^\/workflows\/\d+\/steps\/0\/successCriteria\/0$/,
      );
      const [action] = locationsOf(events, 'action-selected');
      assert.deepInclude(action, { uri, line: 636, column: 9 });
      assert.match(action?.jsonPointer ?? '', /^\/workflows\/\d+\/failureActions\/0$/);
    },
  );

  specify('should follow a chain of $ref path items to the operation', async function () {
    const events = await run('chained-pathitem/workflow.arazzo.yaml', 'testWorkflow', {
      sourceMap: true,
    });

    assert.deepEqual(locationsOf(events, 'openapi-operation-request-start'), [
      {
        uri: fixture('chained-pathitem/paths/pets.json'),
        jsonPointer: '/collection/get',
        line: 3,
        column: 12,
      },
    ]);
  });

  specify('should locate steps and criteria in the result trace', async function () {
    const runner = await ArazzoRunner.load(fixture('workflow-control-flow.arazzo.yaml'), {
      httpClient: respond(500),
      sourceMap: true,
    });

    const result = await runner.execute('inheritsFailureActions', {
      inputs: { status: 'available' },
    });

    const [step] = result.steps;
    assert.deepInclude(step.location, { line: 639, column: 9 });
    assert.deepInclude(step.successCriteria[0].location, { line: 642, column: 13 });
  });

  specify('should reject a malformed document with source maps too', async function () {
    for (const sourceMap of [false, true]) {
      let caught: unknown;
      try {
        await ArazzoRunner.load(fixture('malformed.arazzo.yaml'), { sourceMap });
      } catch (error) {
        caught = error;
      }
      assert.instanceOf(caught, DocumentLoadError, `sourceMap: ${sourceMap}`);
    }
  });

  specify('should locate a dependsOn entry and a foreign workflow', async function () {
    const dependsOn = await run('cross-document.arazzo.yaml', 'crossDocumentDependsOn', {
      sourceMap: true,
    });
    const step = await run('cross-document.arazzo.yaml', 'crossDocumentStep', {
      sourceMap: true,
    });

    assert.deepEqual(locationsOf(dependsOn, 'dependency-start'), [
      {
        uri: fixture('cross-document.arazzo.yaml'),
        jsonPointer: '/workflows/1/dependsOn/0',
        line: 45,
        column: 9,
      },
    ]);
    const [, child] = locationsOf(step, 'workflow-start');
    assert.strictEqual(child?.uri, fixture('cross-document-child.arazzo.yaml'));
    assert.isNumber(child?.line);
  });
});
