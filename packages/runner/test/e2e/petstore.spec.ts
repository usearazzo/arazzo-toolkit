import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  OpenAPIOperationExecutor,
  StepExecutor,
  WorkflowExecutor,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const run = async (entryPath: string, workflowId: string, inputs: Record<string, unknown>) => {
  const registry = new DocumentRegistry();
  const document = await registry.acquireEntryDocument(entryPath);
  // no httpClient: the operation executor defaults to httpClientFetch, real HTTP
  const stepExecutor = new StepExecutor({
    document,
    registry,
    operationExecutor: new OpenAPIOperationExecutor(),
  });
  const executor = new WorkflowExecutor({ document, registry, stepExecutor });

  return executor.execute(workflowId, {
    inputs,
    executeOptions: { server: process.env.PETSTORE_URL },
  });
};

describe('petstore workflows against a live petstore', function () {
  specify('authenticateAndOrderPet', async function () {
    const result = await run(
      path.join(__dirname, '..', 'fixtures', 'petstore-order-workflow.arazzo.yaml'),
      'authenticateAndOrderPet',
      {
        username: 'theUser',
        password: '12345',
        preferredPetStatus: 'available',
        orderQuantity: 1,
        shipDate: new Date().toISOString(),
      },
    );

    assert.strictEqual(result.status, 'completed');
    assert.isNumber(result.outputs?.orderId);
    assert.strictEqual(result.outputs?.orderStatus, 'placed');
    assert.strictEqual(result.outputs?.orderQuantity, 1);
    assert.isString(result.outputs?.petName);
  });

  specify('loginUserRetrievePet', async function () {
    const result = await run(
      path.join(__dirname, 'fixtures', 'LoginAndRetrievePets.arazzo.yaml'),
      'loginUserRetrievePet',
      { username: 'theUser', password: '12345' },
    );

    assert.strictEqual(result.status, 'completed');
    assert.isArray(result.outputs?.available);
  });
});
