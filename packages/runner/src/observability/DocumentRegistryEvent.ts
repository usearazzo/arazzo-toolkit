import type { ArazzoRunnerEventBase } from './ArazzoRunnerEvent.ts';

/**
 * The registry started loading a document it had neither cached nor already
 * loading. Cache hits emit nothing.
 * @public
 */
export interface DocumentLoadStartEvent extends ArazzoRunnerEventBase {
  readonly type: 'document-load-start';
  readonly level: 'debug';
  /**
   * The canonical URI of the document.
   */
  readonly uri: string;
}

/**
 * The registry loaded and cached a document. A load that fails throws and
 * emits no settled event.
 * @public
 */
export interface DocumentLoadSettledEvent extends ArazzoRunnerEventBase {
  readonly type: 'document-load-settled';
  readonly level: 'debug';
  readonly uri: string;
}

/**
 * An event the {@link DocumentRegistry} emits.
 * @public
 */
export type DocumentRegistryEvent = DocumentLoadStartEvent | DocumentLoadSettledEvent;
