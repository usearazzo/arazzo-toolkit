import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert } from 'chai';

import { DocumentRegistry, type ArazzoDocument } from '../../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'list-workflows.arazzo.yaml');

describe('ArazzoDocument', function () {
  let document: ArazzoDocument;

  before(async function () {
    document = await new DocumentRegistry().acquireEntryDocument(fixturePath);
  });

  context('listWorkflows', function () {
    specify('should list every addressable workflow in document order', function () {
      assert.deepStrictEqual(document.listWorkflows(), [
        {
          workflowId: 'findPets',
          jsonPointer: '/workflows/0',
          summary: 'Find pets by status',
          description: 'Finds pets by status.\n\nReturns **every** match.',
        },
        { workflowId: 'bare', jsonPointer: '/workflows/1' },
        {
          workflowId: 'numericSummary',
          jsonPointer: '/workflows/3',
          description: 'Summary is not a string',
        },
      ]);
    });
  });
});
