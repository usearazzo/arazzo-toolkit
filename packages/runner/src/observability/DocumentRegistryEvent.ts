import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The registry started loading a document it had neither cached nor already
 * loading. Cache hits emit nothing.
 *
 * Registry events carry no `runId`: the registry is shared, and one load can
 * serve several runs at once.
 * @public
 */
export interface DocumentLoadStartEvent extends ArazzoRunnerEventBase {
  readonly type: 'document-load-start';
  /**
   * The canonical URI of the document.
   */
  readonly uri: string;
}

/**
 * The registry loaded a document, which it caches right after. A load that
 * fails throws and emits no settled event; an observer that throws here
 * leaves the document uncached.
 * @public
 */
export interface DocumentLoadSettledEvent extends ArazzoRunnerEventBase {
  readonly type: 'document-load-settled';
  readonly uri: string;
}

/**
 * An event the {@link DocumentRegistry} emits.
 * @public
 */
export type DocumentRegistryEvent = DocumentLoadStartEvent | DocumentLoadSettledEvent;
