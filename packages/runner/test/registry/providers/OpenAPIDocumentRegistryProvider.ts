import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';
import { toJSON } from '@speclynx/apidom-core';
import { isOpenApi3_0Element } from '@speclynx/apidom-ns-openapi-3-0';

import OpenAPIDocumentRegistryProvider from '../../../src/registry/providers/OpenAPIDocumentRegistryProvider.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', '..', 'fixtures', 'petstore.openapi.json');
const duplicateFixturePath = (name: string) => path.join(__dirname, '..', '..', 'fixtures', name);
const duplicateFirstWins = [
  ['getPet', '/paths/~1pet~1first/get'],
  ['getInventory', '/paths/~1store~1inventory/get'],
];

describe('OpenAPIDocumentRegistryProvider', function () {
  context('provide', function () {
    specify('should provide an OpenAPI document', async function () {
      const provider = new OpenAPIDocumentRegistryProvider();
      const doc = await provider.provide(fixturePath);

      assert.isTrue(isOpenApi3_0Element(doc.parseResult.api));
    });

    specify('should produce a serializable document', async function () {
      const provider = new OpenAPIDocumentRegistryProvider();
      const doc = await provider.provide(fixturePath);
      const json = toJSON(doc.parseResult.api!);

      assert.isString(json);
    });

    specify(
      'should index the first operation of a duplicated operationId (OpenAPI 2.0)',
      async function () {
        const provider = new OpenAPIDocumentRegistryProvider();
        const doc = await provider.provide(
          duplicateFixturePath('duplicate-operation-id.openapi-2-0.json'),
        );

        assert.deepStrictEqual([...doc.operationIndex], duplicateFirstWins);
      },
    );

    specify(
      'should index the first operation of a duplicated operationId (OpenAPI 3.0)',
      async function () {
        const provider = new OpenAPIDocumentRegistryProvider();
        const doc = await provider.provide(
          duplicateFixturePath('duplicate-operation-id.openapi.json'),
        );

        assert.deepStrictEqual([...doc.operationIndex], duplicateFirstWins);
      },
    );

    specify(
      'should index the first operation of a duplicated operationId (OpenAPI 3.1)',
      async function () {
        const provider = new OpenAPIDocumentRegistryProvider();
        const doc = await provider.provide(
          duplicateFixturePath('duplicate-operation-id.openapi-3-1.json'),
        );

        assert.deepStrictEqual([...doc.operationIndex], duplicateFirstWins);
      },
    );
  });
});
