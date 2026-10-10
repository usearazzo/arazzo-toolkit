import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import {
  DocumentRegistry,
  WorkflowExecutor,
  StepExecutor,
  OpenAPIOperationExecutor,
  type HTTPClient,
  type OpenAPIOperationRequest,
} from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.join(__dirname, '..', 'fixtures', 'pet-coupons.arazzo.yaml');

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A stub petstore serving the operations the example calls — including the
 * coupons endpoint, which exists only in the example's own OpenAPI description.
 */
const petstore: HTTPClient = async (request) => {
  const { pathname } = new URL(request.url);
  if (pathname.endsWith('/pet/findByTags') || pathname.endsWith('/pet/findByStatus')) {
    return jsonResponse([{ id: 10, name: 'doggie', status: 'available' }]);
  }
  if (pathname.endsWith('/pet/10/coupons')) {
    return jsonResponse({ id: 1, couponCode: 'PUPPY10', percentage: 10 });
  }
  if (pathname.endsWith('/store/order')) {
    return jsonResponse({ id: 777, ...JSON.parse(request.body as string) });
  }
  return jsonResponse({ message: 'not found' }, 404);
};

describe('WorkflowExecutor — OAI pet-coupons example', function () {
  let executor: WorkflowExecutor;
  let requests: OpenAPIOperationRequest[];

  beforeEach(async function () {
    requests = [];
    const registry = new DocumentRegistry();
    const document = await registry.acquireEntryDocument(entryPath);
    const operationExecutor = new OpenAPIOperationExecutor({
      httpClient: (request) => {
        requests.push(request);
        return petstore(request);
      },
    });
    const stepExecutor = new StepExecutor({ document, registry, operationExecutor });
    executor = new WorkflowExecutor({ document, registry, stepExecutor });
  });

  // the example's OpenAPI description declares no servers.
  const executeOptions = { server: 'https://petstore.example.com/api/v3' };

  const orderBody = (): unknown => JSON.parse(requests.at(-1)?.body as string);

  specify('should apply a coupon and output the placed order id', async function () {
    const result = await executor.execute('apply-coupon', {
      inputs: { my_pet_tags: ['puppy', 'dalmatian'], store_id: 'pets.example.com' },
      executeOptions,
    });

    assert.strictEqual(result.status, 'completed');
    assert.deepEqual(result.outputs, { apply_coupon_pet_order_id: 777 });
    // the coupon found by the previous step reaches the order; the optional
    // `quantity` input was not passed, so its member is omitted.
    assert.deepEqual(orderBody(), {
      petId: 10,
      couponCode: 'PUPPY10',
      status: 'placed',
      complete: false,
    });
  });

  specify('should buy an available pet and output the placed order id', async function () {
    const result = await executor.execute('buy-available-pet', {
      inputs: { store_id: 'pets.example.com' },
      executeOptions,
    });

    assert.strictEqual(result.status, 'completed');
    assert.deepEqual(result.outputs, { buy_pet_order_id: 777 });
    assert.deepEqual(orderBody(), { petId: 10, status: 'placed', complete: false });
  });

  specify('should place an order directly', async function () {
    const result = await executor.execute('place-order', {
      inputs: { pet_id: 10, quantity: 2, coupon_code: 'PUPPY10' },
      executeOptions,
    });

    assert.strictEqual(result.status, 'completed');
    assert.deepEqual(result.outputs, { workflow_order_id: 777 });
    assert.deepEqual(orderBody(), {
      petId: 10,
      quantity: 2,
      couponCode: 'PUPPY10',
      status: 'placed',
      complete: false,
    });
  });
});
