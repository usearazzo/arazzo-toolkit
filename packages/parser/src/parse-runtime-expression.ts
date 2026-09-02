import {
  parse as parseRuntimeExpression,
  ArazzoRuntimeExpressionParseError,
  type ASTTranslator,
  type ParseOptions,
  type ParseResult,
  type ASTNode,
} from '@swaggerexpert/arazzo-runtime-expression';

/**
 * Options for parsing Arazzo Runtime Expressions.
 * @public
 */
export type Options = ParseOptions<ASTTranslator>;

/**
 * Result of parsing an Arazzo Runtime Expression: the foundation ParseResult
 * bound to the AST node type this parser produces.
 * @public
 */
export type Result = ParseResult<ASTNode>;

/**
 * Default options for parsing Arazzo Runtime Expressions. Empty on purpose:
 * the underlying grammar package supplies its own defaults, including a fresh
 * ASTTranslator per call.
 * @public
 */
export const defaultOptions: Options = {};

/**
 * Parses an Arazzo Runtime Expression (e.g. `$inputs.username`,
 * `$steps.myStep.outputs.result`, `$response.body#/pets/0/id`) into its AST.
 *
 * A pure, context-free syntax parser: the expression string in, an AST plus
 * position-carrying diagnostics (`result.matched` / `result.maxMatched`) out.
 * No evaluation is performed and no document is required; evaluating the
 * parsed expression against runtime state is the runner's responsibility.
 *
 * The expression must be the bare form without surrounding braces. Splitting a
 * `{expression}` template into literal and expression spans is left to
 * `@swaggerexpert/arazzo-runtime-expression`'s own `extract`/`interpolate`
 * functions, which remain a foundation dependency rather than being wrapped
 * here.
 *
 * @param expression - The runtime expression source string
 * @param options - Parse options (uses defaultOptions when not provided)
 * @returns The parse result: `{ result, tree, stats, trace }`. On success,
 * `result.success` is `true` and `tree` holds the AST. On failure,
 * `result.success` is `false`, `tree` is `undefined`, and `result.maxMatched`
 * gives the offset into `expression` up to which parsing succeeded.
 * @throws TypeError - When `expression` is not a string.
 * @throws ArazzoRuntimeExpressionParseError - When parsing fails for a reason
 * other than invalid syntax (an unexpected internal error). Invalid syntax is
 * never thrown; it is reported through the returned `result`.
 *
 * @example
 * Valid expression
 * ```typescript
 * import { parseRuntimeExpression } from '@usearazzo/parser';
 *
 * const { result, tree } = parseRuntimeExpression('$steps.myStep.outputs.result');
 * // result.success === true
 * // tree === { type: 'StepsExpression', stepId: 'myStep', field: 'outputs', outputName: 'result' }
 * ```
 *
 * @example
 * Invalid expression
 * ```typescript
 * import { parseRuntimeExpression } from '@usearazzo/parser';
 *
 * const { result, tree } = parseRuntimeExpression('$unknown.thing');
 * // result.success === false
 * // tree === undefined
 * // result.maxMatched === 0 - the offset parsing failed at
 * ```
 * @public
 */
export function parse(expression: string, options: Options = defaultOptions): Result {
  return parseRuntimeExpression(expression, options);
}

export type { ASTNode };
export { ArazzoRuntimeExpressionParseError };
