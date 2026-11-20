import { assert } from 'chai';

import EventChannel from '../../src/observability/EventChannel.ts';
import { instrument, type ArazzoRunnerEvent } from '../../src/index.ts';

describe('EventChannel', function () {
  const capture = (event: Record<string, unknown>): Record<string, unknown> => {
    let seen: unknown;
    const channel = new EventChannel<ArazzoRunnerEvent>({
      observer: (delivered) => {
        seen = delivered;
      },
      now: () => 42,
    });
    channel.emit(event as never);
    return seen as Record<string, unknown>;
  };

  specify('should have observers only with an observer or instrumentation', function () {
    const channel = new EventChannel({});
    assert.isFalse(channel.hasObservers);

    const remove = instrument({ observer: () => {} });
    try {
      assert.isTrue(channel.hasObservers);
    } finally {
      remove();
    }
    assert.isFalse(channel.hasObservers);
  });

  specify('should deliver a frozen deep copy stamped with the clock', function () {
    const outputs = { pet: { id: 7 } };

    const event = capture({ type: 'workflow:settled', outputs });

    assert.strictEqual(event.timestamp, 42);
    assert.notStrictEqual(event.outputs, outputs);
    assert.deepEqual(event.outputs, outputs);
    assert.isTrue(Object.isFrozen(event));
    assert.isTrue(Object.isFrozen((event.outputs as { pet: object }).pet));
  });

  specify('should copy an own __proto__ key as data', function () {
    const outputs = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');

    const event = capture({ type: 'workflow:settled', outputs });

    const copy = event.outputs as Record<string, unknown>;
    assert.deepEqual(Object.keys(copy), ['a', '__proto__']);
    assert.strictEqual(Object.getPrototypeOf(copy), Object.prototype);
    assert.isUndefined((copy as { polluted?: unknown }).polluted);
  });

  specify("should omit the event's own undefined fields but keep them in data", function () {
    const event = capture({
      type: 'workflow:settled',
      runId: undefined,
      outputs: { x: undefined },
    });

    assert.notProperty(event, 'runId');
    assert.property(event.outputs, 'x');
  });
});
