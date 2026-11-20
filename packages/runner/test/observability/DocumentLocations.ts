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

// the start of a location's range, as an editor shows it (1-based)
const startOf = (location: DocumentLocation | undefined): [number, number] | undefined =>
  location?.range === undefined
    ? undefined
    : [location.range.start.line + 1, location.range.start.character + 1];

// a location without its range, for comparing uri and pointer alone
const placeOf = (location: DocumentLocation | undefined) =>
  location === undefined ? undefined : { uri: location.uri, jsonPointer: location.jsonPointer };

const locationsOf = (events: ArazzoRunnerEvent[], type: ArazzoRunnerEvent['type']) =>
  events
    .filter((event) => event.type === type)
    .map((event) => (event as { location?: DocumentLocation }).location);

describe('Document locations', function () {
  const components = 'arazzo-with-components/workflow.arazzo.yaml';

  specify('should locate workflows, steps and actions with source maps', async function () {
    const events = await run(components, 'testWorkflow', { sourceMap: true });
    const uri = fixture(components);

    const [workflow] = locationsOf(events, 'workflow:start');
    assert.deepEqual(placeOf(workflow), { uri, jsonPointer: '/workflows/0' });
    assert.deepEqual(startOf(workflow), [10, 5]);
    assert.deepEqual(locationsOf(events, 'workflow:normalize:start'), [workflow]);
    const [step] = locationsOf(events, 'step:start');
    assert.deepEqual(placeOf(step), { uri, jsonPointer: '/workflows/0/steps/0' });
    assert.deepEqual(startOf(step), [15, 9]);
    // a workflow-level action reached through $components: where it is defined
    const [action] = locationsOf(events, 'action:selected');
    assert.deepEqual(placeOf(action), { uri, jsonPointer: '/components/successActions/finish' });
    assert.deepEqual(startOf(action), [42, 7]);
  });

  specify('should locate by JSON Pointer alone without source maps', async function () {
    const events = await run(components, 'testWorkflow');

    assert.deepEqual(locationsOf(events, 'step:start'), [
      { uri: fixture(components), jsonPointer: '/workflows/0/steps/0' },
    ]);
  });

  specify('should locate an OpenAPI operation in its own document', async function () {
    const events = await run(components, 'testWorkflow', { sourceMap: true });

    const [location] = locationsOf(events, 'openapi:operation:request:start');
    assert.deepInclude(location, {
      uri: fixture('petstore.openapi.json'),
      jsonPointer: '/paths/~1pet~1{petId}/get',
    });
    assert.isAbove(location?.range?.start.line ?? 0, 0);
    assert.deepEqual(locationsOf(events, 'openapi:operation:request:settled'), [location]);
  });

  specify('should locate an operation of a $ref path item in the file it names', async function () {
    const events = await run('external-pathitem/workflow.arazzo.yaml', 'testWorkflow', {
      sourceMap: true,
    });

    const [location] = locationsOf(events, 'openapi:operation:request:start');
    assert.deepEqual(placeOf(location), {
      uri: fixture('external-pathitem/paths/pets.json'),
      jsonPointer: '/get',
    });
    assert.deepEqual(startOf(location), [2, 10]);
  });

  specify(
    'should locate an inherited action and a criterion where each is written',
    async function () {
      const events = await run('workflow-control-flow.arazzo.yaml', 'inheritsFailureActions', {
        sourceMap: true,
        httpClient: respond(500),
      });
      const uri = fixture('workflow-control-flow.arazzo.yaml');

      const [criterion] = locationsOf(events, 'criterion:evaluated');
      assert.strictEqual(criterion?.uri, uri);
      // the whole `condition: $statusCode == 200` entry, as an LSP range
      assert.deepEqual(criterion?.range, {
        start: { line: 641, character: 12 },
        end: { line: 641, character: 41 },
      });
      assert.match(
        criterion?.jsonPointer ?? '',
        /^\/workflows\/\d+\/steps\/0\/successCriteria\/0$/,
      );
      const [action] = locationsOf(events, 'action:selected');
      assert.strictEqual(action?.uri, uri);
      assert.deepEqual(startOf(action), [636, 9]);
      assert.match(action?.jsonPointer ?? '', /^\/workflows\/\d+\/failureActions\/0$/);
    },
  );

  specify('should follow a chain of $ref path items to the operation', async function () {
    const events = await run('chained-pathitem/workflow.arazzo.yaml', 'testWorkflow', {
      sourceMap: true,
    });

    const [location] = locationsOf(events, 'openapi:operation:request:start');
    assert.deepEqual(placeOf(location), {
      uri: fixture('chained-pathitem/paths/pets.json'),
      jsonPointer: '/collection/get',
    });
    assert.deepEqual(startOf(location), [3, 12]);
  });

  specify(
    'should locate an operation written next to a $ref where it is written',
    async function () {
      const events = await run('sibling-pathitem/workflow.arazzo.yaml', 'testWorkflow', {
        sourceMap: true,
      });

      const [sibling, referenced] = locationsOf(events, 'openapi:operation:request:start');
      assert.deepEqual(placeOf(sibling), {
        uri: fixture('sibling-pathitem/openapi.json'),
        jsonPointer: '/paths/~1pets/post',
      });
      assert.deepEqual(startOf(sibling), [8, 15]);
      assert.deepEqual(placeOf(referenced), {
        uri: fixture('sibling-pathitem/paths/pets.json'),
        jsonPointer: '/collection/get',
      });
    },
  );

  specify('should locate steps and criteria in the result trace', async function () {
    const runner = await ArazzoRunner.load(fixture('workflow-control-flow.arazzo.yaml'), {
      httpClient: respond(500),
      sourceMap: true,
    });

    const result = await runner.execute('inheritsFailureActions', {
      inputs: { status: 'available' },
    });

    const [step] = result.steps;
    assert.deepEqual(startOf(step.location), [639, 9]);
    assert.deepEqual(startOf(step.successCriteria[0].location), [642, 13]);
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

    const [entry] = locationsOf(dependsOn, 'dependency:start');
    assert.deepEqual(placeOf(entry), {
      uri: fixture('cross-document.arazzo.yaml'),
      jsonPointer: '/workflows/1/dependsOn/0',
    });
    assert.deepEqual(startOf(entry), [45, 9]);
    const [, child] = locationsOf(step, 'workflow:start');
    assert.strictEqual(child?.uri, fixture('cross-document-child.arazzo.yaml'));
    assert.isDefined(child?.range);
  });
});
