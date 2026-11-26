// A CommonJS consumer of the published declarations: "typescript:check-published-types"
// type-checks it against the built types/ through the package's require conditions.
import { ArazzoRunner, Redactor, combineObservers } from '@usearazzo/runner';
import { loggingObserver } from '@usearazzo/runner/observability/logging';
import { eventStream } from '@usearazzo/runner/observability/stream';
import { ArazzoRunnerInstrumentation } from '@usearazzo/runner/observability/opentelemetry';

const redactor = new Redactor();
const log = loggingObserver(({ level, message }) => console[level](message), { redactor });
const events = eventStream({ redactor });
export const instrumentation = new ArazzoRunnerInstrumentation({ enabled: false });
export const runner = ArazzoRunner.load('workflow.arazzo.yaml', {
  observer: combineObservers(log, events.observer),
});
