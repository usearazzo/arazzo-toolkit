import { assert } from 'chai';
import { refractRequestBody } from '@speclynx/apidom-ns-arazzo-1';

import {
  RequestBodyResolver,
  RuntimeExpressionEvaluator,
  ResolverError,
  type RuntimeExpressionResolver,
} from '../../src/index.ts';

const captureRejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected promise to reject, but it resolved');
};

describe('RequestBodyResolver', function () {
  const runtime = new RuntimeExpressionEvaluator(
    { inputs: { petId: 7, order: { item: 'x', qty: 1 } } },
    { strict: false },
  );
  const resolve: RuntimeExpressionResolver = (expression) => runtime.evaluate(expression);
  const scope = { stepId: 'step1' };
  let resolver: RequestBodyResolver;

  beforeEach(function () {
    resolver = new RequestBodyResolver();
  });

  context('resolve', function () {
    specify('should return undefined when there is no request body', async function () {
      assert.isUndefined(await resolver.resolve(undefined, resolve, scope));
    });

    specify('should resolve a whole-expression payload to its typed value', async function () {
      const requestBody = refractRequestBody({ payload: '$inputs.order' });

      assert.deepEqual(await resolver.resolve(requestBody, resolve, scope), {
        payload: { item: 'x', qty: 1 },
      });
    });

    specify('should use a literal object payload as-is', async function () {
      const requestBody = refractRequestBody({ payload: { a: 1, b: 'two' } });

      assert.deepEqual(await resolver.resolve(requestBody, resolve, scope), {
        payload: { a: 1, b: 'two' },
      });
    });

    specify('should include the declared content type', async function () {
      const requestBody = refractRequestBody({
        contentType: 'application/json',
        payload: { a: 1 },
      });

      assert.deepEqual(await resolver.resolve(requestBody, resolve, scope), {
        payload: { a: 1 },
        contentType: 'application/json',
      });
    });

    specify('should apply a replacement at a JSON Pointer target', async function () {
      const requestBody = refractRequestBody({
        payload: { petId: 0, qty: 1 },
        replacements: [
          { target: '/petId', value: '$inputs.petId' },
          { target: '/qty', value: 10 },
        ],
      });

      assert.deepEqual(await resolver.resolve(requestBody, resolve, scope), {
        payload: { petId: 7, qty: 10 },
      });
    });

    specify('should apply a replacement at a nested JSON Pointer target', async function () {
      const requestBody = refractRequestBody({
        payload: { order: { item: 'old' } },
        replacements: [{ target: '/order/item', value: '$inputs.order' }],
      });

      const result = (await resolver.resolve(requestBody, resolve, scope)) as {
        payload: { order: { item: unknown } };
      };
      assert.deepEqual(result.payload.order.item, { item: 'x', qty: 1 });
    });

    specify('should replace the whole payload for an empty pointer target', async function () {
      const requestBody = refractRequestBody({
        payload: { ignored: true },
        replacements: [{ target: '', value: '$inputs.order' }],
      });

      assert.deepEqual(await resolver.resolve(requestBody, resolve, scope), {
        payload: { item: 'x', qty: 1 },
      });
    });

    specify('should throw ResolverError for a non-JSON-Pointer (XPath) target', async function () {
      // a JSON Pointer must start with `/`; a bare path like `a/b` (or an XPath)
      // is not a valid pointer and is treated as an unsupported target.
      const requestBody = refractRequestBody({
        payload: { a: 1 },
        replacements: [{ target: 'a/b', value: 1 }],
      });

      const error = await captureRejection(resolver.resolve(requestBody, resolve, scope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /JSON Pointer/);
    });

    specify(
      'should throw ResolverError when the target does not resolve in the payload',
      async function () {
        const requestBody = refractRequestBody({
          payload: { a: 1 },
          replacements: [{ target: '/missing/deep', value: 1 }],
        });

        const error = await captureRejection(resolver.resolve(requestBody, resolve, scope));

        assert.instanceOf(error, ResolverError);
        assert.match(error.message, /does not resolve/);
      },
    );

    specify('should not mutate a payload aliased from a runtime expression', async function () {
      // when the payload is `$inputs.order`, the evaluator returns the live
      // context object by reference; applying a replacement must not corrupt it.
      const inputs = { order: { item: 'x', qty: 1 } };
      const isolated = new RuntimeExpressionEvaluator({ inputs }, { strict: false });
      const isolatedResolve: RuntimeExpressionResolver = (expression) =>
        isolated.evaluate(expression);
      const requestBody = refractRequestBody({
        payload: '$inputs.order',
        replacements: [{ target: '/qty', value: 999 }],
      });

      const result = (await resolver.resolve(requestBody, isolatedResolve, scope)) as {
        payload: { qty: number };
      };

      assert.strictEqual(result.payload.qty, 999);
      assert.strictEqual(inputs.order.qty, 1, 'the source $inputs.order must be untouched');
    });

    specify('should reject a prototype-polluting target', async function () {
      const requestBody = refractRequestBody({
        payload: { a: 1 },
        replacements: [{ target: '/__proto__/polluted', value: 'yes' }],
      });

      const error = await captureRejection(resolver.resolve(requestBody, resolve, scope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /does not resolve/);
      assert.isUndefined(({} as Record<string, unknown>).polluted);
    });

    specify('should throw ResolverError for present but non-list replacements', async function () {
      const requestBody = refractRequestBody({
        contentType: 'application/json',
        payload: {},
        replacements: 'not-a-list',
      });

      const error = await captureRejection(resolver.resolve(requestBody as never, resolve, scope));

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /is present but is not a list/);
      assert.strictEqual(error.reason, 'malformed-replacements');
      assert.strictEqual(error.target, 'requestBody.replacements');
      assert.strictEqual(error.stepId, scope.stepId);
    });

    specify('should throw ResolverError for a present but non-map requestBody', async function () {
      // a scalar requestBody refracts to a StringElement, on which `.payload`,
      // `.replacements` and `.contentType` are all plain `undefined` — without
      // this guard the step would silently send no body and report success.
      const error = await captureRejection(
        resolver.resolve('not-an-object' as never, resolve, scope),
      );

      assert.instanceOf(error, ResolverError);
      assert.match(error.message, /is present but is not a map/);
      assert.strictEqual(error.reason, 'malformed-request-body');
      assert.strictEqual(error.target, 'requestBody');
      assert.strictEqual(error.stepId, scope.stepId);
    });
  });

  context('payload expressions', function () {
    const inputs = {
      petId: 7,
      name: 'Rex',
      nothing: null,
      note: { text: '{$inputs.name}', ref: '$inputs.petId' },
    };
    const payloadRuntime = new RuntimeExpressionEvaluator({ inputs }, { strict: false });
    const payloadResolve: RuntimeExpressionResolver = (expression) =>
      payloadRuntime.evaluate(expression);

    const payloadOf = async (payload: unknown, replacements?: unknown[]): Promise<unknown> => {
      const requestBody = refractRequestBody(
        replacements === undefined ? { payload } : { payload, replacements },
      );
      return (await resolver.resolve(requestBody, payloadResolve, scope))?.payload;
    };

    const resolverError = async (payload: unknown): Promise<ResolverError> => {
      const error = await captureRejection(payloadOf(payload));
      assert.instanceOf(error, ResolverError);
      return error;
    };

    specify(
      'should resolve bare-expression object members to their typed values',
      async function () {
        assert.deepEqual(await payloadOf({ petId: '$inputs.petId', status: 'placed' }), {
          petId: 7,
          status: 'placed',
        });
      },
    );

    specify('should resolve expressions in nested objects and arrays', async function () {
      assert.deepEqual(
        await payloadOf({ order: { petId: '$inputs.petId' }, tags: ['$inputs.name', 'literal'] }),
        { order: { petId: 7 }, tags: ['Rex', 'literal'] },
      );
    });

    specify('should render a braced expression member as a string', async function () {
      // only the bare form preserves the type; `{$...}` is embedded and always
      // interpolates to a string.
      assert.deepEqual(await payloadOf({ petId: '{$inputs.petId}' }), { petId: '7' });
    });

    specify('should interpolate expressions embedded in a string member', async function () {
      assert.deepEqual(await payloadOf({ note: 'Order for {$inputs.name} (#{$inputs.petId})' }), {
        note: 'Order for Rex (#7)',
      });
    });

    specify(
      'should interpolate a JSON templated string payload, keeping its braces',
      async function () {
        const template = '{\n  "petOrder": { "petId": "{$inputs.petId}", "status": "placed" }\n}';

        assert.strictEqual(
          await payloadOf(template),
          '{\n  "petOrder": { "petId": "7", "status": "placed" }\n}',
        );
      },
    );

    specify('should interpolate an XML templated string payload', async function () {
      assert.strictEqual(
        await payloadOf('<order><petId>{$inputs.petId}</petId></order>'),
        '<order><petId>7</petId></order>',
      );
    });

    specify('should keep strings without expression attempts unchanged', async function () {
      assert.deepEqual(await payloadOf({ a: '{hello}', b: '$ not an expression', c: '{"x": 1}' }), {
        a: '{hello}',
        b: '$ not an expression',
        c: '{"x": 1}',
      });
    });

    specify('should keep an authored __proto__ key as a plain member', async function () {
      const payload = (await payloadOf(
        JSON.parse('{"__proto__": {"polluted": "$inputs.name"}}'),
      )) as object;

      assert.deepEqual(Object.getOwnPropertyDescriptor(payload, '__proto__')?.value, {
        polluted: 'Rex',
      });
      assert.strictEqual(Object.getPrototypeOf(payload), Object.prototype);
      assert.isUndefined(({} as Record<string, unknown>).polluted);
    });

    specify('should not evaluate object keys', async function () {
      assert.deepEqual(await payloadOf({ '$inputs.petId': 1 }), { '$inputs.petId': 1 });
    });

    specify('should not evaluate expressions inside resolved values', async function () {
      // a resolved value is data, never a template — even when it looks like one.
      assert.deepEqual(await payloadOf('$inputs.note'), inputs.note);
      assert.deepEqual(await payloadOf({ note: '$inputs.note' }), { note: inputs.note });
    });

    specify('should omit an object member whose expression does not resolve', async function () {
      // an optional input that was not passed reads as "not provided".
      assert.deepEqual(await payloadOf({ petId: '$inputs.petId', quantity: '$inputs.quantity' }), {
        petId: 7,
      });
    });

    specify('should keep a member whose expression resolves to null', async function () {
      assert.deepEqual(await payloadOf({ value: '$inputs.nothing' }), { value: null });
    });

    specify('should embed null as an empty string and objects as JSON text', async function () {
      assert.deepEqual(await payloadOf({ a: 'v={$inputs.nothing}', b: 'note={$inputs.note}' }), {
        a: 'v=',
        b: 'note={"text":"{$inputs.name}","ref":"$inputs.petId"}',
      });
    });

    specify('should resolve a top-level array payload', async function () {
      assert.deepEqual(await payloadOf(['$inputs.petId', 'literal']), [7, 'literal']);
    });

    specify('should omit an unresolved member of an object inside an array', async function () {
      // the member belongs to an object, so it is omitted rather than thrown.
      assert.deepEqual(await payloadOf([{ petId: '$inputs.petId', qty: '$inputs.missing' }]), [
        { petId: 7 },
      ]);
    });

    specify('should leave an empty object when every member is unresolved', async function () {
      assert.deepEqual(await payloadOf({ order: { a: '$inputs.missing', b: '$inputs.gone' } }), {
        order: {},
      });
    });

    specify('should apply a replacement whose value resolves to null', async function () {
      assert.deepEqual(
        await payloadOf({ petId: 0 }, [{ target: '/petId', value: '$inputs.nothing' }]),
        {
          petId: null,
        },
      );
    });

    specify('should apply a replacement over a member that was an expression', async function () {
      // payload expressions resolve first; replacements then apply to the result.
      assert.deepEqual(
        await payloadOf({ petId: '$inputs.petId' }, [{ target: '/petId', value: 1 }]),
        {
          petId: 1,
        },
      );
    });

    specify('should not interpolate a replacement value', async function () {
      // a replacement value is a literal or one whole expression — never a template.
      assert.deepEqual(
        await payloadOf({ petId: 0 }, [{ target: '/petId', value: '{$inputs.petId}' }]),
        {
          petId: '{$inputs.petId}',
        },
      );
    });

    specify('should skip a replacement whose value does not resolve', async function () {
      assert.deepEqual(
        await payloadOf({ petId: 0, qty: 1 }, [
          { target: '/petId', value: '$inputs.missing' },
          { target: '/qty', value: '$inputs.petId' },
        ]),
        { petId: 0, qty: 7 },
      );
    });

    specify(
      'should throw ResolverError when a whole-expression payload does not resolve',
      async function () {
        const error = await resolverError('$inputs.missing');

        assert.strictEqual(error.reason, 'unresolved-expression');
        assert.strictEqual(error.target, 'requestBody.payload');
        assert.strictEqual(error.stepId, scope.stepId);
        assert.match(error.message, /\$inputs\.missing/);
      },
    );

    specify('should throw ResolverError when an array element does not resolve', async function () {
      // dropping the element would shift the indices the author wrote.
      const error = await resolverError({ tags: ['first', '$inputs.missing'] });

      assert.strictEqual(error.reason, 'unresolved-expression');
      assert.strictEqual(error.target, 'requestBody.payload#/tags/1');
    });

    specify(
      'should throw ResolverError when an embedded expression does not resolve',
      async function () {
        // an embedded miss cannot be omitted — it would render as an empty string.
        const error = await resolverError({ order: { note: 'Order for {$inputs.missing}' } });

        assert.strictEqual(error.reason, 'unresolved-expression');
        assert.strictEqual(error.target, 'requestBody.payload#/order/note');
        assert.match(error.message, /\$inputs\.missing/);
      },
    );

    specify(
      'should report an embedded miss in a string payload at the payload itself',
      async function () {
        const error = await resolverError('{"petId": "{$inputs.missing}"}');

        assert.strictEqual(error.reason, 'unresolved-expression');
        assert.strictEqual(error.target, 'requestBody.payload');
      },
    );

    specify('should throw ResolverError for an invalid embedded expression', async function () {
      const error = await resolverError({ query: 'a={$inputs.petId}&b={$inputs.}' });

      assert.strictEqual(error.reason, 'invalid-expression');
      assert.strictEqual(error.target, 'requestBody.payload#/query');
      assert.match(error.message, /\{\$inputs\.\}/);
    });

    specify(
      'should treat every {$ span that does not parse as an invalid expression',
      async function () {
        // `{$` always starts an expression attempt, including unterminated ones.
        for (const text of ['{$}', '{$foo.bar}', 'tail {$url']) {
          const error = await resolverError({ value: text });

          assert.strictEqual(error.reason, 'invalid-expression', text);
          assert.strictEqual(error.target, 'requestBody.payload#/value', text);
        }
      },
    );

    specify('should escape member names in the reported JSON Pointer', async function () {
      const error = await resolverError({ 'a/b': { '~c': '{$inputs.missing}' } });

      assert.strictEqual(error.target, 'requestBody.payload#/a~1b/~0c');
    });
  });
});
