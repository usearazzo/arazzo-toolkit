import type { ParseResultElement } from '@usearazzo/parser';
import { parseArazzo, defaultParseArazzoOptions } from '@usearazzo/parser';
import {
  readFile,
  File,
  mergeOptions,
  url,
  type ApiDOMReferenceOptions,
} from '@speclynx/apidom-reference/configuration/empty';
import { UnmatchedResolverError } from '@speclynx/apidom-reference/configuration/empty';
import { toValue } from '@speclynx/apidom-core';
import { isArrayElement, isStringElement } from '@speclynx/apidom-datamodel';
import { traverse, type Path } from '@speclynx/apidom-traverse';
import {
  isStepElement,
  type SourceDescriptionElement,
  type WorkflowElement,
} from '@speclynx/apidom-ns-arazzo-1';

import * as constants from '../../constants.ts';
import ArazzoDocument from '../../document/ArazzoDocument.ts';
import DocumentRegistryProvider, {
  circularReplacer,
  type DocumentRegistryProviderOptions,
} from './DocumentRegistryProvider.ts';
import ArazzoWorkflowIndex from '../../document/ArazzoWorkflowIndex.ts';
import ArazzoStepIndex from '../../document/ArazzoStepIndex.ts';
import ArazzoSourceDescriptionIndex from '../../document/ArazzoSourceDescriptionIndex.ts';

/**
 * Options for loading an Arazzo document.
 * @public
 */
export type ArazzoDocumentRegistryProviderOptions = DocumentRegistryProviderOptions;

/**
 * Default options for loading an Arazzo document.
 *
 * The provider only parses the Arazzo document; dereferencing is deferred
 * to the normalizer when a specific workflow is accessed.
 */
export const providerOptionsOverride: ArazzoDocumentRegistryProviderOptions = {
  resolve: {
    resolverOpts: {
      cache: {
        maxEntries: constants.MAX_HTTP_CACHE_ENTRIES,
        maxStaleAge: constants.MAX_HTTP_CACHE_STALE_AGE,
      },
    },
  },
  dereference: {
    immutable: false,
    circular: 'replace',
    circularReplacer,
    strategyOpts: {
      sourceDescriptions: false,
    },
  },
};

/**
 * Provides ArazzoDocument instances for the DocumentRegistry.
 *
 * Parses the Arazzo document and builds its workflow and source description
 * indexes — the document itself is a container.
 * @public
 */
class ArazzoDocumentRegistryProvider extends DocumentRegistryProvider {
  readonly #options: ArazzoDocumentRegistryProviderOptions;

  constructor(options: ArazzoDocumentRegistryProviderOptions = {}) {
    super();
    this.#options = mergeOptions(providerOptionsOverride as ApiDOMReferenceOptions, options);
  }

  async canProvide(uri: string): Promise<boolean> {
    try {
      const options = this.#buildParseOptions();
      const data = await readFile(uri, options);
      const file = new File({ uri, data });
      const parsers = options.parse.parsers.filter((p) => p.name.startsWith('arazzo'));

      for (const parser of parsers) {
        if (await parser.canParse(file)) return true;
      }
    } catch (error: unknown) {
      if (error instanceof UnmatchedResolverError) return false;
      throw error;
    }

    return false;
  }

  /**
   * Loads an Arazzo document from a URI and produces an ArazzoDocument.
   */
  async provide(uri: string): Promise<ArazzoDocument> {
    const parseResult = await parseArazzo(uri, this.#buildParseOptions());
    const { workflowIndex, stepIndex, sourceDescriptionIndex } = this.#buildIndexes(
      uri,
      parseResult,
    );

    return new ArazzoDocument(uri, parseResult, workflowIndex, stepIndex, sourceDescriptionIndex);
  }

  /**
   * Builds all indexes in one traversal of the parse result.
   *
   * A source description's canonical URI is resolved here too — against the
   * document's base URI, into the exact form the document registry keys on —
   * so every consumer works with a ready-to-use, non-relative URI. The first
   * element of a duplicated source description name wins.
   */
  #buildIndexes(
    uri: string,
    parseResult: ParseResultElement,
  ): {
    workflowIndex: ArazzoWorkflowIndex;
    stepIndex: ArazzoStepIndex;
    sourceDescriptionIndex: ArazzoSourceDescriptionIndex;
  } {
    const workflowIndex = new ArazzoWorkflowIndex();
    const stepIndex = new ArazzoStepIndex();
    const sourceDescriptionIndex = new ArazzoSourceDescriptionIndex();

    traverse(parseResult.api, {
      WorkflowElement(path: Path) {
        const workflow = path.node as WorkflowElement;
        const workflowId = toValue(workflow.workflowId);

        if (typeof workflowId !== 'string') return path.skip();
        if (workflowId === '') return path.skip();

        const workflowPointer = path.formatPath('jsonpointer');
        workflowIndex.set(workflowId, workflowPointer);

        // steps are indexed by list position; malformed entries are left to the
        // executor to report, the index simply omits them.
        const steps = new Map<string, string>();
        if (isArrayElement(workflow.steps)) {
          [...workflow.steps].forEach((step, index) => {
            if (!isStepElement(step)) return;
            const stepId = toValue(step.stepId);
            if (typeof stepId !== 'string' || stepId === '') return;
            if (!steps.has(stepId)) steps.set(stepId, `${workflowPointer}/steps/${index}`);
          });
        }
        stepIndex.set(workflowId, steps);

        return path.skip();
      },

      SourceDescriptionElement(path: Path) {
        const element = path.node as SourceDescriptionElement;
        if (!isStringElement(element.name)) return path.skip();

        const name = toValue(element.name) as string;
        if (!sourceDescriptionIndex.has(name)) {
          sourceDescriptionIndex.set(name, {
            element,
            uri: isStringElement(element.url)
              ? url.sanitize(url.stripHash(url.resolve(uri, toValue(element.url) as string)))
              : undefined,
          });
        }

        return path.skip();
      },
    });

    return { workflowIndex, stepIndex, sourceDescriptionIndex };
  }

  #buildParseOptions(): ApiDOMReferenceOptions {
    return mergeOptions(defaultParseArazzoOptions as ApiDOMReferenceOptions, this.#options);
  }
}

export default ArazzoDocumentRegistryProvider;
