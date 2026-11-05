import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { toJSON } from '@speclynx/apidom-core';
import { isArazzoSpecification1Element } from '@speclynx/apidom-ns-arazzo-1';

import ArazzoDocumentRegistryProvider from '../../../src/registry/providers/ArazzoDocumentRegistryProvider.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'petstore-order-workflow.arazzo.yaml',
);
const controlFlowFixturePath = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'workflow-control-flow.arazzo.yaml',
);
const duplicateFixturePath = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'duplicate-workflow-id.arazzo.yaml',
);

describe('ArazzoDocumentRegistryProvider', function () {
  context('provide', function () {
    specify('should provide an Arazzo document', async function () {
      const provider = new ArazzoDocumentRegistryProvider();
      const doc = await provider.provide(fixturePath);

      assert.isTrue(isArazzoSpecification1Element(doc.parseResult.api));
    });

    specify('should produce a serializable document', async function () {
      const provider = new ArazzoDocumentRegistryProvider();
      const doc = await provider.provide(fixturePath);
      const json = toJSON(doc.parseResult.api!);

      assert.isString(json);
    });

    specify(
      'should index the steps of the first workflow of a duplicated workflowId',
      async function () {
        const provider = new ArazzoDocumentRegistryProvider();
        const doc = await provider.provide(duplicateFixturePath);

        assert.deepStrictEqual(
          [...doc.stepIndex].map(([workflowId, steps]) => [workflowId, [...steps]]),
          [
            ['a', [['inventory', '/workflows/0/steps/0']]],
            ['b', [['inventory', '/workflows/1/steps/0']]],
          ],
        );
      },
    );

    specify('should index the first step of a duplicated stepId', async function () {
      const provider = new ArazzoDocumentRegistryProvider();
      const doc = await provider.provide(controlFlowFixturePath);
      const workflowPointer = doc.workflowIndex.get('duplicateStepIds');

      assert.deepStrictEqual(
        [...doc.stepIndex.get('duplicateStepIds')!],
        [
          ['s', `${workflowPointer}/steps/0`],
          ['reader', `${workflowPointer}/steps/1`],
        ],
      );
    });
  });
});
