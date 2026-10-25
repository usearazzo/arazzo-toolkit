import type ArazzoDocument from './document/ArazzoDocument.ts';
import type { WorkflowId } from './document/ArazzoWorkflowIndex.ts';
import DocumentRegistry from './registry/DocumentRegistry.ts';
import OpenAPIOperationExecutor, {
  type OpenAPIOperationExecutorOptions,
} from './executor/OpenAPIOperationExecutor.ts';
import StepExecutor from './executor/StepExecutor.ts';
import WorkflowExecutor, {
  type WorkflowExecutorOptions,
  type WorkflowExecuteOptions,
  type WorkflowExecutionResult,
} from './executor/WorkflowExecutor.ts';
import InvalidEntryDocumentError from './errors/InvalidEntryDocumentError.ts';

/**
 * Options for {@link ArazzoRunner.load}.
 *
 * Every option is a seam of a building block the runner wires: `registry` is
 * the {@link DocumentRegistry} the documents load into (a fresh one with the
 * default providers when omitted), `httpClient` and `requestInterceptor` go to
 * the {@link OpenAPIOperationExecutor}, and the rest go to the
 * {@link WorkflowExecutor}.
 * @public
 */
export interface ArazzoRunnerLoadOptions
  extends
    Pick<OpenAPIOperationExecutorOptions, 'httpClient' | 'requestInterceptor'>,
    Pick<WorkflowExecutorOptions, 'maxSteps' | 'maxWorkflowDepth' | 'sleep' | 'now'> {
  /**
   * The registry to load the documents into. A registry backs one entry
   * document: loading a different one into it throws.
   */
  readonly registry?: DocumentRegistry;
}

/**
 * Options for the ArazzoRunner constructor.
 * @public
 */
export interface ArazzoRunnerOptions extends Omit<ArazzoRunnerLoadOptions, 'registry'> {
  /**
   * The entry Arazzo document holding the workflows to run.
   */
  readonly document: ArazzoDocument;
  /**
   * The document registry whose entry document is `document`.
   */
  readonly registry: DocumentRegistry;
}

/**
 * Runs the workflows of one Arazzo document.
 *
 * A thin facade over the building blocks: it wires a {@link DocumentRegistry},
 * an {@link OpenAPIOperationExecutor}, a {@link StepExecutor} and a
 * {@link WorkflowExecutor} with their defaults, so running a workflow takes a
 * `load` and an `execute`. The building blocks stay public for callers that
 * need to compose them differently.
 * @public
 */
class ArazzoRunner {
  readonly document: ArazzoDocument;
  readonly registry: DocumentRegistry;
  readonly #executor: WorkflowExecutor;

  /**
   * Loads the entry Arazzo document at `uri` (a file system path or URL) and
   * returns a runner bound to it.
   *
   * @throws UnmatchedProviderError - When no provider can load the document
   * @throws InvalidEntryDocumentError - When the document is not an Arazzo
   * document, or the given registry already backs another entry document
   */
  static async load(uri: string, options: ArazzoRunnerLoadOptions = {}): Promise<ArazzoRunner> {
    const { registry = new DocumentRegistry(), ...rest } = options;
    const document = await registry.acquireEntryDocument(uri);

    return new ArazzoRunner({ ...rest, document, registry });
  }

  /**
   * Binds a runner to an entry document the caller already acquired.
   *
   * @throws InvalidEntryDocumentError - When `document` is not the entry document of `registry`
   */
  constructor(options: ArazzoRunnerOptions) {
    const { document, registry, httpClient, requestInterceptor, ...workflowExecutorOptions } =
      options;

    // a registry pins every entry document it acquires but reports only the
    // first as its entry, so one registry serves one entry document.
    if (registry.entryDocument !== document) {
      throw new InvalidEntryDocumentError(
        `Document at "${document.uri}" is not the entry document of the given registry`,
        { uri: document.uri },
      );
    }

    const operationExecutor = new OpenAPIOperationExecutor({ httpClient, requestInterceptor });
    const stepExecutor = new StepExecutor({ document, registry, operationExecutor });

    this.document = document;
    this.registry = registry;
    this.#executor = new WorkflowExecutor({
      ...workflowExecutorOptions,
      document,
      registry,
      stepExecutor,
    });
  }

  /**
   * Runs the named workflow to completion, returning its outcome; see
   * {@link WorkflowExecutor.execute}.
   */
  execute(
    workflowId: WorkflowId,
    options: WorkflowExecuteOptions = {},
  ): Promise<WorkflowExecutionResult> {
    return this.#executor.execute(workflowId, options);
  }
}

export default ArazzoRunner;
