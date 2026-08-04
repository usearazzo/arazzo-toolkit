import { assert } from 'chai';
import dedent from 'dedent';

import { ApilintCodes } from '@speclynx/apidom-ls';

import {
  validate,
  DiagnosticSeverity,
  createTextDocument,
  defaultLanguageServiceContext,
} from '../src/index.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const specArazzoFullValid = fs
  .readFileSync(path.join(__dirname, 'fixtures', 'arazzo-full-valid.yaml'))
  .toString();

const specArazzoFullInvalid = fs
  .readFileSync(path.join(__dirname, 'fixtures', 'arazzo-full-invalid.yaml'))
  .toString();

describe('validate', function () {
  this.timeout(10000);

  context('given valid Arazzo document', function () {
    const validArazzo = dedent`
      arazzo: '1.0.1'
      info:
        title: My Workflow
        version: '1.0.0'
      sourceDescriptions:
        - name: myApi
          type: openapi
          url: https://example.com/openapi.json
      workflows:
        - workflowId: myWorkflow
          steps:
            - stepId: step1
              operationId: myApi.getUsers
    `;

    specify('should return no errors', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', validArazzo);
      const diagnostics = await validate(textDocument);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.lengthOf(errors, 0);
    });
  });

  context('given valid Arazzo document from file', function () {
    specify('should not return errors', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', specArazzoFullValid);
      const diagnostics = await validate(textDocument);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.equal(errors.length, 0);
    });
  });

  context('given invalid Arazzo document from file', function () {
    specify('should return errors', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', specArazzoFullInvalid);
      const diagnostics = await validate(textDocument);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.isAbove(errors.length, 0);
    });
  });

  context('given Arazzo document missing required title in info', function () {
    const missingTitle = dedent`
      arazzo: '1.0.1'
      info:
        version: '1.0.0'
      sourceDescriptions:
        - name: myApi
          type: openapi
          url: https://example.com/openapi.json
      workflows:
        - workflowId: myWorkflow
          steps:
            - stepId: step1
              operationId: myApi.getUsers
    `;

    specify('should return ARAZZO_INFO_FIELD_TITLE_REQUIRED error', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', missingTitle);
      const diagnostics = await validate(textDocument);
      assert.equal(
        ApilintCodes.ARAZZO_INFO_FIELD_TITLE_REQUIRED,
        9010200,
        'ARAZZO_INFO_FIELD_TITLE_REQUIRED should be diagnostic code 9010200',
      );
      const titleRequired = diagnostics.find(
        (d) => d.code === ApilintCodes.ARAZZO_INFO_FIELD_TITLE_REQUIRED,
      );
      assert.isDefined(titleRequired, 'expected diagnostic with code 9010200');
      assert.equal(titleRequired!.severity, DiagnosticSeverity.Error);
      assert.isTrue(
        titleRequired!.range.start.line < titleRequired!.range.end.line ||
          (titleRequired!.range.start.line === titleRequired!.range.end.line &&
            titleRequired!.range.start.character < titleRequired!.range.end.character),
        'range should have start position before end position',
      );
    });
  });

  context('given valid YAML represented as array', function () {
    const yamlArray = dedent`
      - item1
      - item2
      - item3
    `;

    specify('should return ARAZZO_NOT_DETECTED error', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', yamlArray);
      const diagnostics = await validate(textDocument);
      const notDetected = diagnostics.find((d) => d.code === ApilintCodes.ARAZZO_NOT_DETECTED);
      assert.isDefined(notDetected, 'expected diagnostic with code 9000001');
      assert.equal(notDetected!.severity, DiagnosticSeverity.Error);
    });
  });

  context('given valid JSON represented as array', function () {
    const jsonArray = '["item1", "item2", "item3"]';

    specify('should return ARAZZO_NOT_DETECTED error', async function () {
      const textDocument = createTextDocument('memory://arazzo.json', jsonArray);
      const diagnostics = await validate(textDocument);
      const notDetected = diagnostics.find((d) => d.code === ApilintCodes.ARAZZO_NOT_DETECTED);
      assert.isDefined(notDetected, 'expected diagnostic with code 9000001');
      assert.equal(notDetected!.severity, DiagnosticSeverity.Error);
    });
  });

  context('given invalid YAML syntax', function () {
    // tabs mixed with spaces causes actual YAML syntax error
    const invalidYaml = "arazzo: '1.0.1'\ninfo:\n\t title: bad";

    specify('should return errors', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', invalidYaml);
      const diagnostics = await validate(textDocument);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.isAbove(errors.length, 0);
    });
  });

  context('given invalid JSON syntax', function () {
    const invalidJson = '{ "arazzo": "1.0.1", invalid }';

    specify('should return errors', async function () {
      const textDocument = createTextDocument('memory://arazzo.json', invalidJson);
      const diagnostics = await validate(textDocument);
      const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      assert.isAbove(errors.length, 0);
    });
  });

  context('given OpenAPI document instead of Arazzo', function () {
    const openApiDoc = dedent`
      openapi: '3.0.3'
      info:
        title: My API
        version: '1.0.0'
      paths: {}
    `;

    specify('should return ARAZZO_NOT_DETECTED error', async function () {
      const textDocument = createTextDocument('memory://openapi.yaml', openApiDoc);
      const diagnostics = await validate(textDocument);
      const notDetected = diagnostics.find((d) => d.code === ApilintCodes.ARAZZO_NOT_DETECTED);
      assert.isDefined(notDetected, 'expected diagnostic with code 9000001');
      assert.equal(notDetected!.severity, DiagnosticSeverity.Error);
    });
  });

  context('given document matching both Arazzo and another specification', function () {
    // the language service classifies documents itself, and Arazzo sits behind
    // every OpenAPI variant in its detection chain, so such a document would be
    // parsed and linted as OpenAPI. it must be rejected rather than reported
    // against another specification's rules.
    const hybrid = dedent`
      arazzo: '1.0.1'
      openapi: '3.0.0'
      info:
        title: My Workflow
        version: '1.0.0'
      sourceDescriptions:
        - name: myApi
          type: openapi
          url: https://example.com/openapi.json
      workflows:
        - workflowId: myWorkflow
          steps:
            - stepId: step1
              operationId: myApi.getUsers
    `;

    specify('should return ARAZZO_NOT_DETECTED error', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', hybrid);
      const diagnostics = await validate(textDocument);
      const notDetected = diagnostics.find((d) => d.code === ApilintCodes.ARAZZO_NOT_DETECTED);
      assert.isDefined(notDetected, 'expected diagnostic with code 9000001');
      assert.equal(notDetected!.severity, DiagnosticSeverity.Error);
    });

    specify('should not report another specification diagnostics', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', hybrid);
      const diagnostics = await validate(textDocument);
      assert.deepEqual(
        diagnostics.map((d) => d.code),
        [ApilintCodes.ARAZZO_NOT_DETECTED],
      );
    });
  });

  context('given Arazzo document using Reusable Objects', function () {
    // Reusable Objects are permitted wherever a Parameter, Success Action or
    // Failure Action Object is. requires @speclynx/apidom-ls >= 2.11.7, which
    // stopped those objects being validated against the referenced type's rules.
    const withReusables = dedent`
      arazzo: '1.0.1'
      info:
        title: My Workflow
        version: '1.0.0'
        summary: A summary
        description: A description
      sourceDescriptions:
        - name: myApi
          type: openapi
          url: https://example.com/openapi.json
      components:
        parameters:
          petId:
            name: petId
            in: query
            value: 1
        successActions:
          done:
            name: done
            type: end
        failureActions:
          bail:
            name: bail
            type: end
      workflows:
        - workflowId: myWorkflow
          summary: A summary
          description: A description
          parameters:
            - reference: $components.parameters.petId
          successActions:
            - reference: $components.successActions.done
          failureActions:
            - reference: $components.failureActions.bail
          steps:
            - stepId: step1
              description: A description
              operationId: myApi.getUsers
              onSuccess:
                - reference: $components.successActions.done
              onFailure:
                - reference: $components.failureActions.bail
    `;

    specify('should return no diagnostics', async function () {
      const textDocument = createTextDocument('memory://arazzo.yaml', withReusables);
      const diagnostics = await validate(textDocument);
      assert.deepEqual(diagnostics, []);
    });
  });

  context('given Arazzo document with a local JSON Schema $ref', function () {
    // reference validation is on by default and requires
    // @speclynx/apidom-ls >= 2.11.7; earlier versions report every local $ref
    // as unresolved regardless of whether the target exists.
    const withRef = (ref: string) => dedent`
      arazzo: '1.0.1'
      info:
        title: My Workflow
        version: '1.0.0'
        summary: A summary
        description: A description
      sourceDescriptions:
        - name: myApi
          type: openapi
          url: https://example.com/openapi.json
      components:
        inputs:
          pet:
            type: object
      workflows:
        - workflowId: myWorkflow
          summary: A summary
          description: A description
          inputs:
            $ref: '${ref}'
          steps:
            - stepId: step1
              description: A description
              operationId: myApi.getUsers
    `;

    specify('should return no diagnostics when the target exists', async function () {
      const textDocument = createTextDocument(
        'memory://arazzo.yaml',
        withRef('#/components/inputs/pet'),
      );
      const diagnostics = await validate(textDocument);
      assert.deepEqual(diagnostics, []);
    });

    specify('should return an error when the target is missing', async function () {
      const textDocument = createTextDocument(
        'memory://arazzo.yaml',
        withRef('#/components/inputs/missing'),
      );
      const diagnostics = await validate(textDocument);
      const unresolved = diagnostics.filter((d) => /reference/i.test(d.message));
      assert.lengthOf(unresolved, 1);
      assert.equal(unresolved[0].severity, DiagnosticSeverity.Error);
    });
  });
});

describe('defaultLanguageServiceContext', function () {
  specify('should make JSON Schema validation opt-in and enable the rest', function () {
    assert.deepEqual(defaultLanguageServiceContext.validationContext, {
      jsonSchemaValidation: false,
      semanticValidation: true,
      referenceValidation: true,
      semanticLinting: true,
      betterAjvErrors: true,
    });
  });
});
