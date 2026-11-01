import { toValue } from '@speclynx/apidom-core';
import { isStringElement } from '@speclynx/apidom-datamodel';
import {
  isCriterionElement,
  isCriterionExpressionTypeElement,
  type CriterionElement,
} from '@speclynx/apidom-ns-arazzo-1';
import { test as isRuntimeExpression } from '@swaggerexpert/arazzo-runtime-expression';

import CriterionError from '../errors/CriterionError.ts';
import CriterionEvaluationError from '../errors/CriterionEvaluationError.ts';
import CriterionErrorReason from './CriterionErrorReason.ts';
import RegexCriterionEvaluator from './RegexCriterionEvaluator.ts';
import SimpleCriterionEvaluator from './SimpleCriterionEvaluator.ts';
import JSONPathCriterionEvaluator from './JSONPathCriterionEvaluator.ts';
import XPathCriterionEvaluator from './XPathCriterionEvaluator.ts';

/**
 * Resolves a runtime expression to a value during criterion evaluation.
 *
 * Used both for a criterion's `context` (regex/jsonpath/xpath) and for the
 * expressions embedded in a `simple` condition. It should resolve leniently —
 * an unresolvable reference returning `undefined` fails the criterion rather
 * than throwing (a common way to drive it is
 * `(expression) => runtimeExpressionEvaluator.evaluate(expression)` with a
 * lenient evaluator).
 * @public
 */
export type CriterionContextResolver = (expression: string) => unknown;

/**
 * Options for the CriterionEvaluator.
 *
 * An injected evaluator signals a condition it cannot evaluate by throwing a
 * {@link CriterionEvaluationError}, which fails the criterion; any other error
 * it throws, a plain {@link CriterionError} included, propagates.
 * @public
 */
export interface CriterionEvaluatorOptions {
  /**
   * Simple condition evaluator. Injectable for testing.
   */
  readonly simple?: SimpleCriterionEvaluator;
  /**
   * Regex condition evaluator. Injectable for testing.
   */
  readonly regex?: RegexCriterionEvaluator;
  /**
   * JSONPath condition evaluator. Injectable for testing.
   */
  readonly jsonpath?: JSONPathCriterionEvaluator;
  /**
   * XPath condition evaluator. Injectable for testing.
   */
  readonly xpath?: XPathCriterionEvaluator;
}

/**
 * Evaluates an Arazzo Criterion Object to a boolean.
 *
 * Dispatches on the criterion's `type` (defaulting to `simple` when omitted):
 * - `simple` — evaluates the condition directly, resolving the runtime
 *   expressions embedded in it.
 * - `regex` — resolves the `context` runtime expression, then applies the
 *   pattern to the resolved value.
 * - `jsonpath` — resolves the `context` runtime expression, then applies the
 *   JSONPath query to the resolved value (met when the query matches). Only the
 *   `rfc9535` version is supported; an explicit other version throws.
 * - `xpath` — resolves the `context` runtime expression, then applies the XPath
 *   3.1 query to the resolved XML value (met by the Effective Boolean Value).
 *   Only the `xpath-31` version is supported; an explicit other version throws.
 *
 * Versions follow Arazzo 1.1.0's Expression Type Object: `rfc9535` and
 * `xpath-31` are allowed values, and an omitted `version` defaults to them.
 * Arazzo 1.0.x lists neither and requires `version`; this evaluator applies
 * the 1.1.0 rule to every document, which accepts more but never evaluates a
 * query under the wrong dialect.
 *
 * A condition that cannot be evaluated fails the criterion (`false`), as
 * Arazzo 1.1.0 requires: a syntax error in the condition, a context the
 * condition cannot apply to (non-XML data for `xpath`), or an XPath evaluation
 * error. The type-specific evaluators report these as a
 * {@link CriterionEvaluationError}, which this facade absorbs; any other error
 * they raise propagates. A criterion that is malformed as written still throws: a
 * missing `condition`, an unknown or unreadable `type`, an unsupported
 * expression `version`, or a `context` that is missing or not a runtime
 * expression.
 *
 * The evaluator is agnostic about how runtime expressions are resolved: the
 * caller supplies a {@link CriterionContextResolver} per evaluation, keeping
 * runtime-state, document, and registry concerns in the runtime expression
 * evaluator rather than duplicated here.
 * @public
 */
class CriterionEvaluator {
  readonly #simple: SimpleCriterionEvaluator;
  readonly #regex: RegexCriterionEvaluator;
  readonly #jsonpath: JSONPathCriterionEvaluator;
  readonly #xpath: XPathCriterionEvaluator;

  constructor(options: CriterionEvaluatorOptions = {}) {
    this.#simple = options.simple ?? new SimpleCriterionEvaluator();
    this.#regex = options.regex ?? new RegexCriterionEvaluator();
    this.#jsonpath = options.jsonpath ?? new JSONPathCriterionEvaluator();
    this.#xpath = options.xpath ?? new XPathCriterionEvaluator();
  }

  /**
   * Evaluates a criterion element, returning whether the condition is met.
   *
   * `resolve` turns a runtime expression into a value: for `simple` it resolves
   * the expressions embedded in the condition; for the other types it resolves
   * the criterion's `context` expression that the condition is applied to.
   */
  evaluate(criterion: CriterionElement, resolve: CriterionContextResolver): boolean {
    if (!isCriterionElement(criterion)) {
      throw new CriterionError('Element is not a Criterion Object', {
        reason: CriterionErrorReason.InvalidCriterion,
      });
    }

    const condition = isStringElement(criterion.condition)
      ? (toValue(criterion.condition) as string)
      : undefined;
    // `condition` is required; an empty string is not a meaningful condition
    // (e.g. an empty regex would match unconditionally), so reject it too.
    if (condition === undefined || condition === '') {
      throw new CriterionError('Criterion is missing a "condition"', {
        reason: CriterionErrorReason.MissingCondition,
      });
    }

    const type = this.#resolveType(criterion);
    this.#requireValidContext(criterion, type);

    try {
      switch (type) {
        case 'simple':
          return this.#simple.evaluate(condition, resolve);
        case 'regex':
          return this.#regex.evaluate(condition, this.#resolveContext(criterion, type, resolve));
        case 'jsonpath':
          // only rfc9535 is supported, Arazzo 1.1.0's default, so an omitted
          // version is accepted. draft-goessner has different semantics and is
          // rejected rather than mis-evaluated.
          this.#requireVersion(criterion, type, condition, 'rfc9535');
          return this.#jsonpath.evaluate(condition, this.#resolveContext(criterion, type, resolve));
        case 'xpath':
          // only XPath 3.1 is supported; xpath-31 is Arazzo 1.1.0's default, so
          // an omitted version is accepted. Older versions are rejected.
          this.#requireVersion(criterion, type, condition, 'xpath-31');
          return this.#xpath.evaluate(condition, this.#resolveContext(criterion, type, resolve));
        default:
          throw new CriterionError(`Unknown criterion type "${type}"`, {
            condition,
            type,
            reason: CriterionErrorReason.UnknownType,
          });
      }
    } catch (error: unknown) {
      // Arazzo 1.1.0: a condition that cannot be evaluated MUST evaluate to fail.
      // The structural checks throw a plain CriterionError and still propagate.
      if (error instanceof CriterionEvaluationError) return false;
      throw error;
    }
  }

  /**
   * Determines the criterion `type`, defaulting to `simple` only when the field
   * is omitted. The `type` field may be a bare string or a Criterion Expression
   * Type Object (whose own `type` names the flavor). A present-but-unreadable
   * `type` throws a {@link CriterionError} rather than silently defaulting.
   */
  #resolveType(criterion: CriterionElement): string {
    const type = criterion.type;
    if (type === undefined) return 'simple';
    if (isCriterionExpressionTypeElement(type) && isStringElement(type.type)) {
      return toValue(type.type) as string;
    }
    if (isStringElement(type)) return toValue(type) as string;
    throw new CriterionError('Criterion has an invalid "type"', {
      reason: CriterionErrorReason.InvalidType,
    });
  }

  /**
   * Extracts the expression `version` from a Criterion Expression Type Object,
   * or `undefined` when no version is declared (a bare-string `type`, or a type
   * object without a `version`) — in which case Arazzo 1.1.0's default for the
   * type applies. A `version` that is present but not a string is malformed and
   * throws a {@link CriterionError} rather than silently defaulting.
   */
  #resolveVersion(criterion: CriterionElement): string | undefined {
    const type = criterion.type;
    if (!isCriterionExpressionTypeElement(type) || type.version === undefined) {
      return undefined;
    }
    if (isStringElement(type.version)) {
      return toValue(type.version) as string;
    }
    throw new CriterionError('Criterion has an invalid expression type "version"', {
      reason: CriterionErrorReason.InvalidVersion,
    });
  }

  /**
   * Enforces that a versioned condition type declares only the one version this
   * runner supports. An omitted version is accepted (Arazzo 1.1.0's default);
   * any other declared version throws a {@link CriterionError}.
   */
  #requireVersion(
    criterion: CriterionElement,
    type: string,
    condition: string,
    supported: string,
  ): void {
    const version = this.#resolveVersion(criterion);
    if (version !== undefined && version !== supported) {
      throw new CriterionError(`Unsupported ${type} version "${version}" (only ${supported})`, {
        condition,
        type,
        reason: CriterionErrorReason.UnsupportedVersion,
      });
    }
  }

  /**
   * Enforces that a present `context` is a valid runtime expression, for every
   * criterion type: the spec types it `{expression}`, and `simple` ignores it,
   * so a malformed one would otherwise go unnoticed there.
   */
  #requireValidContext(criterion: CriterionElement, type: string): void {
    const { context } = criterion;
    if (context === undefined) return;
    if (!isStringElement(context) || !isRuntimeExpression(toValue(context) as string)) {
      throw new CriterionError('Criterion has a "context" that is not a valid runtime expression', {
        type,
        reason: CriterionErrorReason.InvalidContext,
      });
    }
  }

  /**
   * Resolves the criterion's `context` runtime expression to the value the
   * condition is applied to. The condition types that need a context (`regex`,
   * `jsonpath`, `xpath`) must declare one; a criterion of such a type without a
   * `context` throws a {@link CriterionError}.
   */
  #resolveContext(
    criterion: CriterionElement,
    type: string,
    resolve: CriterionContextResolver,
  ): unknown {
    if (!isStringElement(criterion.context)) {
      throw new CriterionError(`Criterion type "${type}" requires a "context"`, {
        type,
        reason: CriterionErrorReason.MissingContext,
      });
    }
    return resolve(toValue(criterion.context) as string);
  }
}

export default CriterionEvaluator;
