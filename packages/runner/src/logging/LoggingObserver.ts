import { toValue } from '@speclynx/apidom-core';
import { Redactor, type ArazzoRunnerEvent, type ArazzoRunnerObserver } from '@usearazzo/runner';

/**
 * The level a log record is written at. Every common logger has these four.
 * @public
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * One log record, made from one event.
 * @public
 */
export interface LogRecord {
  readonly level: LogLevel;
  /**
   * A one-line, human-readable summary of the event, e.g.
   * `step placeOrder failed after 2 attempts`.
   */
  readonly message: string;
  /**
   * The event, masked, as structured fields: its `type`, `runId`, `stepId`,
   * `location` and the rest. The selected action of `action:selected` is
   * given by its `name` and `type`, not as the document's element.
   */
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Writes one log record to the logger of your choice. Loggers disagree on
 * argument order, so this is where a record is handed over the way yours
 * expects: `logger[level](fields, message)` for pino or bunyan,
 * `logger.log(level, message, fields)` for winston,
 * `console[level](message, fields)` for the console.
 * @public
 */
export type LogFunction = (record: LogRecord) => void;

/**
 * Options for {@link loggingObserver}.
 * @public
 */
export interface LoggingObserverOptions {
  /**
   * Masks each event before it is logged. A `new Redactor()` with the default
   * field patterns when omitted; there is no way to log unmasked events
   * through this adapter. A settled event's `error` is the exception: it is
   * logged as `execute` rejects with it.
   */
  readonly redactor?: Redactor;
  /**
   * The level for an event type, replacing the default for every event of
   * that type: `{ 'criterion:evaluated': 'info' }`.
   */
  readonly levels?: Readonly<Partial<Record<ArazzoRunnerEvent['type'], LogLevel>>>;
}

/**
 * The default level: `info` for the boundaries of workflows and steps, `warn`
 * for a failed step, `error` for a failed workflow or a step that threw, and
 * `debug` for the decisions and machinery under them.
 */
const defaultLevel = (event: ArazzoRunnerEvent): LogLevel => {
  switch (event.type) {
    case 'workflow:start':
    case 'step:start':
      return 'info';
    case 'workflow:settled':
      // a transferred workflow did not fail itself: its target reports its own outcome
      return event.status === 'failed' ? 'error' : 'info';
    case 'step:settled':
      if (event.error !== undefined) return 'error';
      return event.successful ? 'info' : 'warn';
    default:
      return 'debug';
  }
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

// what a settled event threw, after its message
const thrown = (event: { readonly error?: unknown }): string => {
  if (event.error === undefined) return '';
  return `: ${event.error instanceof Error ? event.error.message : String(event.error)}`;
};

const message = (event: ArazzoRunnerEvent): string => {
  switch (event.type) {
    case 'workflow:start':
      return `workflow ${event.workflowId} started${event.via === 'root' ? '' : ` (${event.via})`}`;
    case 'workflow:settled':
      return `workflow ${event.workflowId} ${event.status}${thrown(event)}`;
    case 'workflow:normalize:start':
      return `workflow ${event.workflowId} normalizing`;
    case 'workflow:normalize:settled':
      return `workflow ${event.workflowId} normalized`;
    case 'dependency:start':
      return `dependency ${event.dependency.workflowId} of ${event.workflowId} started`;
    case 'dependency:settled':
      return `dependency ${event.dependency.workflowId} of ${event.workflowId} ${
        event.memoized ? 'already ' : ''
      }${event.settledStatus}`;
    case 'step:start':
      return `step ${event.stepId} started`;
    case 'step:attempt':
      return `step ${event.stepId} attempt ${event.attempt}`;
    case 'criterion:evaluated': {
      const { condition, met, diagnostic } = event.criterion;
      const outcome = met ? 'met' : 'not met';
      return `step ${event.stepId} criterion ${condition} ${outcome}${
        diagnostic === undefined ? '' : `: ${diagnostic.message}`
      }`;
    }
    case 'action:selected':
      return event.action === undefined
        ? `step ${event.stepId} matched no action (${event.transition.kind})`
        : `step ${event.stepId} selected action ${String(toValue(event.action.name))} (${
            event.transition.kind
          })`;
    case 'retry:wait':
      return `step ${event.stepId} waits ${event.delayMs} ms before attempt ${event.attempt + 1}`;
    case 'retry:reference:start':
      return `step ${event.stepId} retry reference ${event.kind} ${event.id} started`;
    case 'retry:reference:settled':
      return `step ${event.stepId} retry reference ${event.kind} ${event.id} ${
        event.successful ? 'succeeded' : 'failed'
      }`;
    case 'step:settled':
      return `step ${event.stepId} ${event.successful ? 'succeeded' : 'failed'} after ${plural(
        event.attempts,
        'attempt',
      )}${thrown(event)}`;
    case 'document:load:start':
      return `loading document ${event.uri}`;
    case 'document:load:settled':
      return `loaded document ${event.uri}`;
    case 'openapi:operation:normalize:start':
      return `operation ${operationName(event)} normalizing`;
    case 'openapi:operation:normalize:settled':
      return `operation ${operationName(event)} normalized`;
    case 'openapi:operation:assembled':
      return `operation ${operationName(event)} assembled`;
    case 'openapi:operation:request:start':
      return `${event.request.method} ${event.request.url}`;
    case 'openapi:operation:request:settled':
      return `operation ${operationName(event)} responded ${event.response.status} (${plural(
        event.response.size,
        'byte',
      )})`;
  }
};

const operationName = (event: {
  readonly operation: { readonly operationId?: string; readonly jsonPointer: string };
}): string => event.operation.operationId ?? event.operation.jsonPointer;

/**
 * The event as log fields: a selected action, the document's own element,
 * becomes its `name` and `type`, so a logger does not serialize an element
 * tree.
 */
const fields = (event: ArazzoRunnerEvent): Readonly<Record<string, unknown>> => {
  if (event.type !== 'action:selected' || event.action === undefined) return { ...event };
  const { action, ...rest } = event;
  return { ...rest, action: { name: toValue(action.name), type: toValue(action.type) } };
};

/**
 * An observer that writes every event as a log record through `log`, masked
 * by a `Redactor` first.
 *
 * Events carry no level, so this adapter gives them one: `info` for workflows
 * and steps starting and settling, `warn` for a failed step, `error` for a
 * failed workflow, and `debug` for attempts, criteria, actions, retries,
 * dependencies, document loads, normalization and requests. A workflow that
 * transferred to another is `info`: the workflow it transferred to reports its
 * own outcome. `levels` overrides it per event type.
 *
 * ```js
 * import pino from 'pino';
 * import { ArazzoRunner } from '@usearazzo/runner';
 * import { loggingObserver } from '@usearazzo/runner/logging';
 *
 * const logger = pino();
 * const runner = await ArazzoRunner.load(uri, {
 *   observer: loggingObserver(({ level, message, fields }) => logger[level](fields, message)),
 * });
 * ```
 * @public
 */
const loggingObserver = (
  log: LogFunction,
  options: LoggingObserverOptions = {},
): ArazzoRunnerObserver => {
  const redactor = options.redactor ?? new Redactor();
  const { levels = {} } = options;

  return (event) => {
    const masked = redactor.event(event);
    log({
      level: levels[masked.type] ?? defaultLevel(masked),
      message: message(masked),
      fields: fields(masked),
    });
  };
};

export default loggingObserver;
