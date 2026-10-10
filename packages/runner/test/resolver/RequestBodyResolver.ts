import { assert } from 'chai';
import { refractRequestBody } from '@speclynx/apidom-ns-arazzo-1';

import {
  RequestBodyResolver,
  RuntimeExpressionEvaluator,
  ResolverError,
  type RuntimeExpressionResolver,
} from '../../src/index.ts';

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
    specify('should return undefined when there is no request body', function () {
      assert.isUndefined(resolver.resolve(undefined, resolve, scope));
    });

    specify('should resolve a whole-expression payload to its typed value', function () {
      const requestBody = refractRequestBody({ payload: '$inputs.order' });

      assert.deepEqual(resolver.resolve(requestBody, resolve, scope), {
        payload: { item: 'x', qty: 1 },
      });
    });

    specify('should use a literal object payload as-is', function () {
      const requestBody = refractRequestBody({ payload: { a: 1, b: 'two' } });

      assert.deepEqual(resolver.resolve(requestBody, resolve, scope), {
        payload: { a: 1, b: 'two' },
      });
    });

    specify('should include the declared content type', function () {
      const requestBody = refractRequestBody({
        contentType: 'application/json',
        payload: { a: 1 },
      });

      assert.deepEqual(resolver.resolve(requestBody, resolve, scope), {
        payload: { a: 1 },
        contentType: 'application/json',
      });
    });

    specify('should apply a replacement at a JSON Pointer target', function () {
      const requestBody = refractRequestBody({
        payload: { petId: 0, qty: 1 },
        replacements: [
          { target: '/petId', value: '$inputs.petId' },
          { target: '/qty', value: 10 },
        ],
      });

      assert.deepEqual(resolver.resolve(requestBody, resolve, scope), {
        payload: { petId: 7, qty: 10 },
      });
    });

    specify('should apply a replacement at a nested JSON Pointer target', function () {
      const requestBody = refractRequestBody({
        payload: { order: { item: 'old' } },
        replacements: [{ target: '/order/item', value: '$inputs.order' }],
      });

      const result = resolver.resolve(requestBody, resolve, scope) as {
        payload: { order: { item: unknown } };
      };
      assert.deepEqual(result.payload.order.item, { item: 'x', qty: 1 });
    });

    specify('should replace the whole payload for an empty pointer target', function () {
      const requestBody = refractRequestBody({
        payload: { ignored: true },
        replacements: [{ target: '', value: '$inputs.order' }],
      });

      assert.deepEqual(resolver.resolve(requestBody, resolve, scope), {
        payload: { item: 'x', qty: 1 },
      });
    });

    specify('should throw ResolverError for a non-JSON-Pointer (XPath) target', function () {
      // a JSON Pointer must start with `/`; a bare path like `a/b` (or an XPath)
      // is not a valid pointer and is treated as an unsupported target.
      const requestBody = refractRequestBody({
        payload: { a: 1 },
        replacements: [{ target: 'a/b', value: 1 }],
      });

      assert.throws(
        () => resolver.resolve(requestBody, resolve, scope),
        ResolverError,
        /JSON Pointer/,
      );
    });

    specify(
      'should throw ResolverError when the target does not resolve in the payload',
      function () {
        const requestBody = refractRequestBody({
          payload: { a: 1 },
          replacements: [{ target: '/missing/deep', value: 1 }],
        });

        assert.throws(
          () => resolver.resolve(requestBody, resolve, scope),
          ResolverError,
          /does not resolve/,
        );
      },
    );

    specify('should not mutate a payload aliased from a runtime expression', function () {
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

      const result = resolver.resolve(requestBody, isolatedResolve, scope) as {
        payload: { qty: number };
      };

      assert.strictEqual(result.payload.qty, 999);
      assert.strictEqual(inputs.order.qty, 1, 'the source $inputs.order must be untouched');
    });

    specify('should reject a prototype-polluting target', function () {
      const requestBody = refractRequestBody({
        payload: { a: 1 },
        replacements: [{ target: '/__proto__/polluted', value: 'yes' }],
      });

      assert.throws(
        () => resolver.resolve(requestBody, resolve, scope),
        ResolverError,
        /does not resolve/,
      );
      assert.isUndefined(({} as Record<string, unknown>).polluted);
    });

    specify('should throw ResolverError for present but non-list replacements', function () {
      const requestBody = refractRequestBody({
        contentType: 'application/json',
        payload: {},
        replacements: 'not-a-list',
      });

      const error = assert.throws(
        () => resolver.resolve(requestBody as never, resolve, scope),
        ResolverError,
        /is present but is not a list/,
      ) as unknown as ResolverError;

      assert.strictEqual(error.reason, 'malformed-replacements');
      assert.strictEqual(error.target, 'requestBody.replacements');
      assert.strictEqual(error.stepId, scope.stepId);
    });

    specify('should throw ResolverError for a present but non-map requestBody', function () {
      // a scalar requestBody refracts to a StringElement, on which `.payload`,
      // `.replacements` and `.contentType` are all plain `undefined` — without
      // this guard the step would silently send no body and report success.
      const error = assert.throws(
        () => resolver.resolve('not-an-object' as never, resolve, scope),
        ResolverError,
        /is present but is not a map/,
      ) as unknown as ResolverError;

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

    const payloadOf = (payload: unknown, replacements?: unknown[]): unknown => {
      const requestBody = refractRequestBody(
        replacements === undefined ? { payload } : { payload, replacements },
      );
      return resolver.resolve(requestBody, payloadResolve, scope)?.payload;
    };

    const resolverError = (payload: unknown): ResolverError =>
      assert.throws(() => payloadOf(payload), ResolverError) as unknown as ResolverError;

    specify('should resolve bare-expression object members to their typed values', function () {
      assert.deepEqual(payloadOf({ petId: '$inputs.petId', status: 'placed' }), {
        petId: 7,
        status: 'placed',
      });
    });

    specify('should resolve expressions in nested objects and arrays', function () {
      assert.deepEqual(
        payloadOf({ order: { petId: '$inputs.petId' }, tags: ['$inputs.name', 'literal'] }),
        { order: { petId: 7 }, tags: ['Rex', 'literal'] },
      );
    });

    specify('should render a braced expression member as a string', function () {
      // only the bare form preserves the type; `{$...}` is embedded and always
      // interpolates to a string.
      assert.deepEqual(payloadOf({ petId: '{$inputs.petId}' }), { petId: '7' });
    });

    specify('should interpolate expressions embedded in a string member', function () {
      assert.deepEqual(payloadOf({ note: 'Order for {$inputs.name} (#{$inputs.petId})' }), {
        note: 'Order for Rex (#7)',
      });
    });

    specify('should interpolate a JSON templated string payload, keeping its braces', function () {
      const template = '{\n  "petOrder": { "petId": "{$inputs.petId}", "status": "placed" }\n}';

      assert.strictEqual(
        payloadOf(template),
        '{\n  "petOrder": { "petId": "7", "status": "placed" }\n}',
      );
    });

    specify('should interpolate an XML templated string payload', function () {
      assert.strictEqual(
        payloadOf('<order><petId>{$inputs.petId}</petId></order>'),
        '<order><petId>7</petId></order>',
      );
    });

    specify('should keep strings without expression attempts unchanged', function () {
      assert.deepEqual(payloadOf({ a: '{hello}', b: '$ not an expression', c: '{"x": 1}' }), {
        a: '{hello}',
        b: '$ not an expression',
        c: '{"x": 1}',
      });
    });

    specify('should keep an authored __proto__ key as a plain member', function () {
      const payload = payloadOf(
        JSON.parse('{"__proto__": {"polluted": "$inputs.name"}}'),
      ) as object;

      assert.deepEqual(Object.getOwnPropertyDescriptor(payload, '__proto__')?.value, {
        polluted: 'Rex',
      });
      assert.strictEqual(Object.getPrototypeOf(payload), Object.prototype);
      assert.isUndefined(({} as Record<string, unknown>).polluted);
    });

    specify('should not evaluate object keys', function () {
      assert.deepEqual(payloadOf({ '$inputs.petId': 1 }), { '$inputs.petId': 1 });
    });

    specify('should not evaluate expressions inside resolved values', function () {
      // a resolved value is data, never a template — even when it looks like one.
      assert.deepEqual(payloadOf('$inputs.note'), inputs.note);
      assert.deepEqual(payloadOf({ note: '$inputs.note' }), { note: inputs.note });
    });

    specify('should omit an object member whose expression does not resolve', function () {
      // an optional input that was not passed reads as "not provided".
      assert.deepEqual(payloadOf({ petId: '$inputs.petId', quantity: '$inputs.quantity' }), {
        petId: 7,
      });
    });

    specify('should keep a member whose expression resolves to null', function () {
      assert.deepEqual(payloadOf({ value: '$inputs.nothing' }), { value: null });
    });

    specify('should skip a replacement whose value does not resolve', function () {
      assert.deepEqual(
        payloadOf({ petId: 0, qty: 1 }, [
          { target: '/petId', value: '$inputs.missing' },
          { target: '/qty', value: '$inputs.petId' },
        ]),
        { petId: 0, qty: 7 },
      );
    });

    specify(
      'should throw ResolverError when a whole-expression payload does not resolve',
      function () {
        const error = resolverError('$inputs.missing');

        assert.strictEqual(error.reason, 'unresolved-expression');
        assert.strictEqual(error.target, 'requestBody.payload');
        assert.strictEqual(error.stepId, scope.stepId);
        assert.match(error.message, /\$inputs\.missing/);
      },
    );

    specify('should throw ResolverError when an array element does not resolve', function () {
      // dropping the element would shift the indices the author wrote.
      const error = resolverError({ tags: ['first', '$inputs.missing'] });

      assert.strictEqual(error.reason, 'unresolved-expression');
      assert.strictEqual(error.target, 'requestBody.payload#/tags/1');
    });

    specify('should throw ResolverError when an embedded expression does not resolve', function () {
      // an embedded miss cannot be omitted — it would render as an empty string.
      const error = resolverError({ order: { note: 'Order for {$inputs.missing}' } });

      assert.strictEqual(error.reason, 'unresolved-expression');
      assert.strictEqual(error.target, 'requestBody.payload#/order/note');
      assert.match(error.message, /\$inputs\.missing/);
    });

    specify('should throw ResolverError for an invalid embedded expression', function () {
      const error = resolverError({ query: 'a={$inputs.petId}&b={$inputs.}' });

      assert.strictEqual(error.reason, 'invalid-expression');
      assert.strictEqual(error.target, 'requestBody.payload#/query');
      assert.match(error.message, /\{\$inputs\.\}/);
    });

    specify('should escape member names in the reported JSON Pointer', function () {
      const error = resolverError({ 'a/b': { '~c': '{$inputs.missing}' } });

      assert.strictEqual(error.target, 'requestBody.payload#/a~1b/~0c');
    });
  });
});
