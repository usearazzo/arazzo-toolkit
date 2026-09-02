import {
  parse as parseCriterionCondition,
  ArazzoCriterionParseError,
  type ASTTranslator,
  type ParseOptions,
  type ParseResult,
  type ConditionAST,
} from '@swaggerexpert/arazzo-criterion';

/**
 * Options for parsing Arazzo "simple" criterion conditions.
 * @public
 */
export type Options = ParseOptions<ASTTranslator>;

/**
 * Result of parsing an Arazzo "simple" criterion condition: the foundation
 * ParseResult bound to the AST node type this parser produces.
 * @public
 */
export type Result = ParseResult<ConditionAST>;

/**
 * Default options for parsing Arazzo "simple" criterion conditions. Empty on
 * purpose: the underlying grammar package supplies its own defaults, including
 * a fresh ASTTranslator per call.
 * @public
 */
export const defaultOptions: Options = {};

/**
 * Parses an Arazzo "simple" criterion condition (e.g. `$statusCode == 200`,
 * `$response.body#/status == 'available' && $response.header.X-Rate-Limit-Remaining > 0`)
 * into its AST.
 *
 * A pure, context-free syntax parser: the condition string in, an AST plus
 * position-carrying diagnostics (`result.matched` / `result.maxMatched`) out.
 * No evaluation is performed and no context is required; evaluating the
 * parsed condition against runtime state is the runner's responsibility.
 * Embedded runtime expression operands are parsed too: each `RuntimeExpression`
 * node in the resulting AST carries its own sub-AST, produced by
 * `@swaggerexpert/arazzo-runtime-expression` (see {@link parseRuntimeExpression}).
 *
 * @param condition - The "simple" criterion condition source string
 * @param options - Parse options (uses defaultOptions when not provided)
 * @returns The parse result: `{ result, tree, stats, trace }`. On success,
 * `result.success` is `true` and `tree` holds the AST. On failure,
 * `result.success` is `false`, `tree` is `undefined`, and `result.maxMatched`
 * gives the offset into `condition` up to which parsing succeeded.
 * @throws TypeError - When `condition` is not a string.
 * @throws ArazzoCriterionParseError - When parsing fails for a reason other
 * than invalid syntax (an unexpected internal error). Invalid syntax is never
 * thrown; it is reported through the returned `result`.
 *
 * @example
 * Valid condition
 * ```typescript
 * import { parseCriterionCondition } from '@usearazzo/parser';
 *
 * const { result, tree } = parseCriterionCondition('$statusCode == 200');
 * // result.success === true
 * // tree.type === 'BinaryExpression'
 * ```
 *
 * @example
 * Invalid condition
 * ```typescript
 * import { parseCriterionCondition } from '@usearazzo/parser';
 *
 * const { result, tree } = parseCriterionCondition('$statusCode ===');
 * // result.success === false
 * // tree === undefined
 * // result.maxMatched - the offset parsing failed at
 * ```
 * @public
 */
export function parse(condition: string, options: Options = defaultOptions): Result {
  return parseCriterionCondition(condition, options);
}

export type { ConditionAST };
export { ArazzoCriterionParseError };
