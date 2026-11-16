import { url } from '@speclynx/apidom-reference/configuration/empty';

import type APIDocument from '../document/APIDocument.ts';
import ArazzoDocument from '../document/ArazzoDocument.ts';
import type DocumentRegistryProvider from './providers/DocumentRegistryProvider.ts';
import ArazzoDocumentRegistryProvider from './providers/ArazzoDocumentRegistryProvider.ts';
import OpenAPIDocumentRegistryProvider from './providers/OpenAPIDocumentRegistryProvider.ts';
import ArazzoRunnerError from '../errors/ArazzoRunnerError.ts';
import DocumentLoadError from '../errors/DocumentLoadError.ts';
import InvalidEntryDocumentError from '../errors/InvalidEntryDocumentError.ts';
import UnmatchedProviderError from '../errors/UnmatchedProviderError.ts';
import * as constants from '../constants.ts';
import EventChannel from '../observability/EventChannel.ts';
import type { ArazzoRunnerObserver } from '../observability/ArazzoRunnerEvent.ts';
import type { DocumentRegistryEvent } from '../observability/DocumentRegistryEvent.ts';

/**
 * Options for the DocumentRegistry.
 * @public
 */
export interface DocumentRegistryOptions {
  readonly providers?: DocumentRegistryProvider[];
  /**
   * Receives the registry's events: the start and end of every document
   * load. Cache hits emit nothing. See {@link DocumentRegistryEvent}.
   */
  readonly observer?: ArazzoRunnerObserver<DocumentRegistryEvent>;
  /**
   * Reads the current time in milliseconds, stamped on each event. Defaults to
   * `performance.now`.
   */
  readonly now?: () => number;
}

/**
 * Registry for API documents keyed by canonical URI.
 *
 * Acts as an LRU cache for parsed documents. The entry Arazzo document
 * is pinned and never evicted. Providers are tried in order to detect
 * and load documents.
 * @public
 */
class DocumentRegistry {
  readonly #documents: Map<string, APIDocument> = new Map();
  readonly #loading: Map<string, Promise<APIDocument>> = new Map();
  readonly #providers: DocumentRegistryProvider[];
  readonly #events: EventChannel<DocumentRegistryEvent> | undefined;

  constructor(options: DocumentRegistryOptions = {}) {
    this.#providers = options.providers ?? [
      new ArazzoDocumentRegistryProvider(),
      new OpenAPIDocumentRegistryProvider(),
    ];
    this.#events = EventChannel.open({ observer: options.observer, now: options.now });
  }

  /**
   * Returns the entry Arazzo document, or undefined if not yet registered.
   */
  get entryDocument(): ArazzoDocument | undefined {
    for (const doc of this.#documents.values()) {
      if (ArazzoDocument.is(doc) && doc.isEntry) {
        return doc;
      }
    }
    return undefined;
  }

  /**
   * Acquires a document by URI. Returns cached document if available,
   * otherwise detects the format, loads via the matching provider,
   * caches, and returns it.
   *
   * Concurrent calls for a document that is still loading share that one
   * load instead of each fetching and parsing it. A failed load is not
   * remembered: the next call tries again.
   *
   * @throws DocumentLoadError - When the document cannot be read or loaded
   * @throws UnmatchedProviderError - When no provider can load the document
   */
  async acquire(uri: string): Promise<APIDocument> {
    const canonicalURI = this.#canonicalize(uri);
    const cachedDocument = this.#get(canonicalURI);
    if (cachedDocument) return cachedDocument;

    const loading = this.#loading.get(canonicalURI);
    if (loading) return loading;

    const load: Promise<APIDocument> = this.#load(canonicalURI).finally(() => {
      // only its own entry: after clear(), a newer load may hold the key
      if (this.#loading.get(canonicalURI) === load) this.#loading.delete(canonicalURI);
    });
    this.#loading.set(canonicalURI, load);
    return load;
  }

  /**
   * Loads a document through the first provider that can provide it, and
   * caches it.
   */
  async #load(canonicalURI: string): Promise<APIDocument> {
    this.#events?.emit({ type: 'document-load-start', uri: canonicalURI });
    for (const provider of this.#providers) {
      let document: APIDocument | undefined;
      try {
        if (await provider.canProvide(canonicalURI)) {
          document = await provider.provide(canonicalURI);
          this.#set(canonicalURI, document);
        }
      } catch (error: unknown) {
        // a document that cannot be read or loaded fails in ApiDOM or the parser;
        // wrapping it keeps every load failure inside the runner's error hierarchy.
        if (error instanceof ArazzoRunnerError) throw error;
        throw new DocumentLoadError(`Failed to load the document at "${canonicalURI}"`, {
          uri: canonicalURI,
          cause: error,
        });
      }
      if (document !== undefined) {
        // outside the try: an observer's own error is not a failed load.
        this.#events?.emit({ type: 'document-load-settled', uri: canonicalURI });
        return document;
      }
    }

    throw new UnmatchedProviderError(`No provider can handle the document at "${canonicalURI}"`, {
      uri: canonicalURI,
    });
  }

  /**
   * Whether a source description of `type` can be loaded at all: some provider
   * loads that type, or does not say which type it loads. A source with no
   * `type` may be of any type, so it can.
   *
   * Answered from the providers alone, without fetching anything — so a
   * caller can skip a load that could only fail, such as an AsyncAPI source
   * while no provider loads AsyncAPI.
   */
  canLoad(type: string | undefined): boolean {
    if (type === undefined) return true;
    return this.#providers.some(
      (provider) =>
        provider.sourceDescriptionType === undefined || provider.sourceDescriptionType === type,
    );
  }

  /**
   * Canonical form of a URI, used as the cache key and handed to providers.
   *
   * A relative file system path resolves against the current working directory
   * first: the canonical URI doubles as the base URI for source description
   * URLs, where a relative base resolves against the filesystem root instead of
   * the document. A leading slash or backslash (UNC, drive-rooted) is already
   * rooted and passes through untouched. The working directory is encoded so a
   * directory name containing `#`, `?` or `%` survives URL parsing.
   */
  #canonicalize(uri: string): string {
    const absoluteURI =
      !url.isHttpUrl(uri) && url.getProtocol(uri) !== 'file' && !/^[\\/]/.test(uri)
        ? url.resolve(url.fromFileSystemPath(url.cwd()), uri)
        : uri;
    return url.sanitize(url.stripHash(absoluteURI));
  }

  /**
   * Acquires the entry Arazzo document and marks it with `isEntry: true`.
   * Validates that the document is an Arazzo specification.
   *
   * @throws DocumentLoadError - When the document cannot be read or loaded
   * @throws UnmatchedProviderError - When no provider can load the document
   * @throws InvalidEntryDocumentError - When the document is not an Arazzo document
   */
  async acquireEntryDocument(uri: string): Promise<ArazzoDocument> {
    const document = await this.acquire(uri);
    if (!ArazzoDocument.is(document)) {
      throw new InvalidEntryDocumentError(`Entry document at "${uri}" is not an Arazzo Document`, {
        uri,
      });
    }
    document.isEntry = true;
    return document;
  }

  /**
   * Drops every cached document. A load still in progress is no longer shared:
   * the next `acquire` of that document starts a fresh load.
   */
  clear(): void {
    this.#documents.clear();
    this.#loading.clear();
  }

  /**
   * Retrieves a document and marks it as recently used.
   */
  #get(uri: string): APIDocument | undefined {
    const doc = this.#documents.get(uri);
    if (doc === undefined) return undefined;

    // move to end (most recently used)
    this.#documents.delete(uri);
    this.#documents.set(uri, doc);
    return doc;
  }

  /**
   * Registers a document in the registry.
   *
   * If the registry is at capacity, the least recently used document
   * is evicted. The entry Arazzo document is never evicted.
   */
  #set(uri: string, document: APIDocument): void {
    if (this.#documents.has(uri)) {
      this.#documents.delete(uri);
    } else if (this.#documents.size >= constants.MAX_DOCUMENT_REGISTRY_SIZE) {
      this.#evictOldest();
    }
    this.#documents.set(uri, document);
  }

  /**
   * Removes a document from the registry.
   * The entry document cannot be removed.
   */
  #delete(uri: string): boolean {
    const doc = this.#documents.get(uri);
    if (doc && ArazzoDocument.is(doc) && doc.isEntry) {
      return false;
    }
    return this.#documents.delete(uri);
  }

  #evictOldest(): void {
    for (const [uri] of this.#documents) {
      if (this.#delete(uri)) return;
    }
  }
}

export default DocumentRegistry;
