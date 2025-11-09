import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

import type { Options as PrettierOptions } from "prettier";

import type { PrettierFormatResult } from "./prettier-format.js";
import { extractAtScope, FormattingScope } from "./prettier-scope.js";

/** Decision matrix comparing all formatting paths. */
export interface FormattingDecisionMatrix {
	/** Configuration used for validation. */
	config: {
		maxLen: number;
		prettierOptions?: PrettierOptions;
	};

	/** Decision flags based on comparison. */
	decisions: {
		/** Can safely use implicit return (fits in all contexts). */
		canBeImplicit: boolean;

		/** Conflict detected (different formatting in different scopes). */
		conflictDetected: boolean;

		/** Any formatting path had an error. */
		hasErrors: boolean;

		/** Implicit fits on one line in inline context. */
		implicitFitsContext: boolean;

		/** Implicit fits on one line in snippet scope. */
		implicitFitsSnippet: boolean;

		/** Implicit is shorter than explicit in inline context. */
		implicitShorterInContext: boolean;

		/** Implicit is shorter than explicit in snippet scope. */
		implicitShorterInSnippet: boolean;
	};

	/** Results for explicit return formatting. */
	explicit: {
		inlineContext: FormattingPathResult | null;
		snippet: FormattingPathResult | null;
	};

	/** Results for implicit return formatting. */
	implicit: {
		inlineContext: FormattingPathResult | null;
		snippet: FormattingPathResult | null;
	};
}

/** Represents the result of formatting in a specific configuration. */
interface FormattingPathResult {
	/** The code that was formatted. */
	code: string;

	/** Whether this path had an error. */
	hasError: boolean;

	/** Whether this represents implicit or explicit return. */
	implicit: boolean;

	/** The formatting result from Prettier. */
	result: PrettierFormatResult;

	/** The scope used for formatting. */
	scope: FormattingScope;
}

/**
 * Gets a summary explanation of the decision for debugging/logging.
 *
 * @param matrix - The formatting decision matrix to summarize.
 * @returns Human-readable summary of the decision.
 */
export function getDecisionSummary(matrix: FormattingDecisionMatrix): string {
	const { decisions } = matrix;

	if (decisions.hasErrors) {
		return "Formatting errors detected, using fallback";
	}

	if (decisions.conflictDetected) {
		return "Conflict between scopes detected";
	}

	if (!decisions.canBeImplicit) {
		if (!decisions.implicitFitsSnippet) {
			return "Implicit doesn't fit in snippet scope";
		}

		if (!decisions.implicitFitsContext) {
			return "Implicit doesn't fit in inline context";
		}

		return "Implicit return not suitable";
	}

	if (decisions.implicitShorterInSnippet) {
		return "Implicit is shorter and fits";
	}

	return "Using implicit return";
}

/**
 * Validates an arrow function by formatting it in all possible paths. This
 * systematic approach replaces ad-hoc single-path checks.
 *
 * @param args - Parameters object.
 * @param args.node - The arrow function expression node.
 * @param args.sourceCode - The ESLint source code object.
 * @param args.context - The ESLint rule context.
 * @param args.maxLength - Maximum line length allowed.
 * @param args.prettierOptions - Prettier configuration options.
 * @returns Complete decision matrix with all formatting paths evaluated.
 */
// eslint-disable-next-line max-lines-per-function -- Centralized logic for formatting validation
export function preValidateFormattingPaths({
	context,
	maxLength,
	node,
	prettierOptions,
	sourceCode,
}: {
	context: TSESLint.RuleContext<any, any>;
	maxLength: number;
	node: TSESTree.ArrowFunctionExpression;
	prettierOptions?: PrettierOptions;
	sourceCode: TSESLint.SourceCode;
}): FormattingDecisionMatrix {
	// Format implicit return in different scopes
	const implicitSnippet = formatPath({
		context,
		implicit: true,
		node,
		prettierOptions,
		scope: FormattingScope.Snippet,
		sourceCode,
	});

	const implicitContext = formatPath({
		context,
		implicit: true,
		node,
		prettierOptions,
		scope: FormattingScope.InlineContext,
		sourceCode,
	});

	// Format explicit return in different scopes
	const explicitSnippet = formatPath({
		context,
		implicit: false,
		node,
		prettierOptions,
		scope: FormattingScope.Snippet,
		sourceCode,
	});

	const explicitContext = formatPath({
		context,
		implicit: false,
		node,
		prettierOptions,
		scope: FormattingScope.InlineContext,
		sourceCode,
	});

	// Build decision matrix by comparing all paths
	const decisions = makeDecisions({
		explicitContext,
		explicitSnippet,
		implicitContext,
		implicitSnippet,
		maxLength,
	});

	return {
		config: {
			maxLen: maxLength,
			prettierOptions,
		},
		decisions,
		explicit: {
			inlineContext: explicitContext,
			snippet: explicitSnippet,
		},
		implicit: {
			inlineContext: implicitContext,
			snippet: implicitSnippet,
		},
	};
}

/**
 * Detects conflicts between different formatting paths. A conflict occurs when
 * different scopes produce contradictory results.
 *
 * @param implicitSnippet - Implicit return in snippet scope.
 * @param implicitContext - Implicit return in inline context.
 * @param maxLength - Maximum line length allowed.
 * @returns True if conflict detected between scopes.
 */
function detectConflict(
	implicitSnippet: FormattingPathResult | null,
	implicitContext: FormattingPathResult | null,
	maxLength: number,
): boolean {
	// If we don't have both snippet and context, no conflict possible
	if (!implicitSnippet || !implicitContext) {
		return false;
	}

	// Check if snippet says "fits" but context says "doesn't fit"
	const snippetFits = fitsOnLine(implicitSnippet.result, maxLength);
	const contextFits = fitsOnLine(implicitContext.result, maxLength);

	if (snippetFits !== contextFits) {
		return true;
	}

	// Check if formatting differs significantly between scopes
	// (e.g., single-line in snippet but multi-line in context)
	if (implicitSnippet.result.isMultiline !== implicitContext.result.isMultiline) {
		return true;
	}

	return false;
}

/**
 * Checks if formatted code fits on one line within max length.
 *
 * @param result - The formatting result to check.
 * @param maxLen - Maximum line length allowed.
 * @returns True if code fits on one line within max length.
 */

function fitsOnLine(result: PrettierFormatResult, maxLength: number): boolean {
	// Must be single line
	if (result.isMultiline) {
		return false;
	}

	// Must fit within maxLen
	if (result.lineLength > maxLength) {
		return false;
	}

	return true;
}

/**
 * Formats code in a specific path (scope + implicit/explicit).
 *
 * @param args - Parameters object.
 * @param args.node - The arrow function expression node.
 * @param args.scope - The formatting scope to use.
 * @param args.sourceCode - The ESLint source code object.
 * @param args.context - The ESLint rule context.
 * @param args.implicit - Whether to format as implicit return.
 * @param args.prettierOptions - Prettier configuration options.
 * @returns Formatting result or null if unable to format.
 */
// eslint-disable-next-line max-lines-per-function -- Centralized logic for formatting a specific path
function formatPath({
	context,
	implicit,
	node,
	prettierOptions,
	scope,
	sourceCode,
}: {
	context: TSESLint.RuleContext<any, any>;
	implicit: boolean;
	node: TSESTree.ArrowFunctionExpression;
	prettierOptions?: PrettierOptions;
	scope: FormattingScope;
	sourceCode: TSESLint.SourceCode;
}): FormattingPathResult | null {
	try {
		const extraction = extractAtScope({
			context,
			node,
			options: {
				implicit,
				prettierOptions,
			},
			scope,
			sourceCode,
		});

		if (extraction === null) {
			return null;
		}

		return {
			code: extraction.code,
			hasError: Boolean(extraction.result.error),
			implicit,
			result: extraction.result,
			scope,
		};
	} catch {
		return null;
	}
}

/**
 * Makes systematic decisions by comparing all formatting paths.
 *
 * @param args - Parameters object.
 * @param args.explicitSnippet - Explicit return in snippet scope.
 * @param args.implicitContext - Implicit return in inline context.
 * @param args.implicitSnippet - Implicit return in snippet scope.
 * @param args.explicitContext - Explicit return in inline context.
 * @param args.maxLength - Maximum line length allowed.
 * @returns Decision flags based on comparison of all paths.
 */
// eslint-disable-next-line max-lines-per-function -- Centralized logic for making formatting decisions
function makeDecisions({
	explicitContext,
	explicitSnippet,
	implicitContext,
	implicitSnippet,
	maxLength,
}: {
	explicitContext: FormattingPathResult | null;
	explicitSnippet: FormattingPathResult | null;
	implicitContext: FormattingPathResult | null;
	implicitSnippet: FormattingPathResult | null;
	maxLength: number;
}): FormattingDecisionMatrix["decisions"] {
	// Check for errors
	const hasErrors =
		Boolean(implicitSnippet?.hasError) ||
		Boolean(implicitContext?.hasError) ||
		Boolean(explicitSnippet?.hasError) ||
		Boolean(explicitContext?.hasError);

	// Check if implicit fits in all available contexts
	const implicitFitsSnippet = implicitSnippet
		? fitsOnLine(implicitSnippet.result, maxLength)
		: false;

	const implicitFitsContext = implicitContext
		? fitsOnLine(implicitContext.result, maxLength)
		: false;

	// Implicit can be used if it fits in at least the snippet scope
	// (inline context is optional - only checked if available)
	const canBeImplicit = implicitFitsSnippet && (implicitContext === null || implicitFitsContext);

	// Compare implicit vs explicit length
	const implicitShorterInSnippet =
		implicitSnippet && explicitSnippet
			? implicitSnippet.result.lineLength < explicitSnippet.result.lineLength
			: false;

	const implicitShorterInContext =
		implicitContext && explicitContext
			? implicitContext.result.lineLength < explicitContext.result.lineLength
			: false;

	// Detect conflicts (different decisions in different scopes)
	const conflictDetected = detectConflict(implicitSnippet, implicitContext, maxLength);

	return {
		canBeImplicit,
		conflictDetected,
		hasErrors,
		implicitFitsContext,
		implicitFitsSnippet,
		implicitShorterInContext,
		implicitShorterInSnippet,
	};
}
