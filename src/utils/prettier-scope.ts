import type { AST_NODE_TYPES, TSESLint, TSESTree } from "@typescript-eslint/utils";
import type { Options as PrettierOptions } from "prettier";
import { formatWithPrettier, type PrettierFormatResult } from "./prettier-format.js";

/**
 * Defines the scope/context in which code should be formatted for analysis.
 */
export enum FormattingScope {
	/**
	 * Format just the arrow function in isolation.
	 * Example: `(x) => x + 1`
	 */
	SNIPPET = "snippet",

	/**
	 * Format as a complete statement (variable declaration, assignment, etc.).
	 * Example: `const fn = (x) => x + 1;`
	 */
	STATEMENT = "statement",

	/**
	 * Format in its inline context (method chain, call expression, etc.).
	 * Example: `.map((x) => x + 1)`
	 */
	INLINE_CONTEXT = "inline_context",

	/**
	 * Format the block body (for block-to-implicit conversion).
	 * Example: `{ return x + 1; }` → `x + 1`
	 */
	BLOCK_BODY = "block_body",
}

interface ScopeExtractionOptions {
	/**
	 * Whether to extract as implicit return (without braces/return keyword).
	 */
	implicit: boolean;

	/**
	 * Prettier configuration to use for formatting.
	 */
	prettierOptions?: PrettierOptions;
}

interface ScopeExtractionResult {
	/**
	 * The code that was formatted.
	 */
	code: string;

	/**
	 * The formatting result from Prettier.
	 */
	result: PrettierFormatResult;

	/**
	 * The scope that was used for extraction.
	 */
	scope: FormattingScope;
}

/**
 * Extracts and formats arrow function code in a specific scope/context.
 *
 * @param node - The arrow function expression node.
 * @param scope - The scope/context to format in.
 * @param sourceCode - The ESLint source code object.
 * @param context - The ESLint rule context.
 * @param options - Extraction options (implicit/explicit, prettier config).
 * @returns Extraction result with formatted code and metrics.
 */
export function extractAtScope(
	node: TSESTree.ArrowFunctionExpression,
	scope: FormattingScope,
	sourceCode: TSESLint.SourceCode,
	context: TSESLint.RuleContext<any, any>,
	options: ScopeExtractionOptions,
): ScopeExtractionResult | null {
	const code = buildCodeForScope(node, scope, sourceCode, options);

	if (code === null) {
		return null;
	}

	const result = formatWithPrettier(code, context, options.prettierOptions);

	return {
		code,
		result,
		scope,
	};
}

/**
 * Builds the code string for a specific scope.
 *
 * @param node - The arrow function expression node.
 * @param scope - The scope to build code for.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options.
 * @returns The code string, or null if it cannot be built.
 */
function buildCodeForScope(
	node: TSESTree.ArrowFunctionExpression,
	scope: FormattingScope,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	switch (scope) {
		case FormattingScope.SNIPPET:
			return buildSnippet(node, sourceCode, options);

		case FormattingScope.STATEMENT:
			return buildStatement(node, sourceCode, options);

		case FormattingScope.INLINE_CONTEXT:
			return buildInlineContext(node, sourceCode, options);

		case FormattingScope.BLOCK_BODY:
			return buildBlockBody(node, sourceCode, options);

		default:
			return null;
	}
}

/**
 * Builds code for SNIPPET scope - just the arrow function in isolation.
 */
function buildSnippet(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	const nodeText = sourceCode.getText(node);
	const arrowIndex = nodeText.indexOf(" => ");

	if (arrowIndex === -1) {
		return null;
	}

	const parameters = nodeText.substring(0, arrowIndex);
	const body = getBodyForFormat(node, sourceCode, options);

	if (body === null) {
		return null;
	}

	return `${parameters} => ${body}`;
}

/**
 * Builds code for STATEMENT scope - full declaration/statement context.
 */
function buildStatement(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	// Check if this is part of a variable declaration or return statement
	const parent = node.parent;

	if (!parent) {
		return buildSnippet(node, sourceCode, options);
	}

	// Variable declaration: const fn = () => ...
	if (parent.type === "VariableDeclarator" && parent.init === node) {
		const grandparent = parent.parent;
		if (grandparent && grandparent.type === "VariableDeclaration") {
			// Get the variable name and declaration keyword
			const declarationKeyword = sourceCode.getFirstToken(grandparent)?.value ?? "const";
			const varName = sourceCode.getText(parent.id);
			const body = getBodyForFormat(node, sourceCode, options);

			if (body === null) {
				return null;
			}

			const params = getParameters(node, sourceCode);
			return `${declarationKeyword} ${varName} = ${params} => ${body};`;
		}
	}

	// Return statement: return () => ...
	if (parent.type === "ReturnStatement") {
		const body = getBodyForFormat(node, sourceCode, options);
		if (body === null) {
			return null;
		}

		const params = getParameters(node, sourceCode);
		return `return ${params} => ${body};`;
	}

	// Property: { key: () => ... }
	if (parent.type === "Property" && parent.value === node) {
		const key = sourceCode.getText(parent.key);
		const body = getBodyForFormat(node, sourceCode, options);

		if (body === null) {
			return null;
		}

		const params = getParameters(node, sourceCode);
		const separator = parent.computed ? ":" : ": ";
		return `{ ${key}${separator}${params} => ${body} }`;
	}

	// Fallback to snippet
	return buildSnippet(node, sourceCode, options);
}

/**
 * Builds code for INLINE_CONTEXT scope - method chain or call expression context.
 */
function buildInlineContext(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	const parent = node.parent;

	if (!parent || parent.type !== "CallExpression") {
		return buildSnippet(node, sourceCode, options);
	}

	// Method chain: .map(() => ...)
	if (parent.callee.type === "MemberExpression") {
		const methodName = sourceCode.getText(parent.callee.property);
		const body = getBodyForFormat(node, sourceCode, options);

		if (body === null) {
			return null;
		}

		const params = getParameters(node, sourceCode);
		return `placeholder.${methodName}(${params} => ${body})`;
	}

	// Function call: useCallback(() => ...)
	const functionName = sourceCode.getText(parent.callee);
	const body = getBodyForFormat(node, sourceCode, options);

	if (body === null) {
		return null;
	}

	const params = getParameters(node, sourceCode);
	return `${functionName}(${params} => ${body})`;
}

/**
 * Builds code for BLOCK_BODY scope - extracting the return value from a block.
 */
function buildBlockBody(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	if (node.body.type !== "BlockStatement") {
		// Already an expression body
		return sourceCode.getText(node.body);
	}

	// Find return statement
	const returnStatement = node.body.body.find(
		(stmt): stmt is TSESTree.ReturnStatement => stmt.type === "ReturnStatement",
	);

	if (!returnStatement || !returnStatement.argument) {
		return null;
	}

	return sourceCode.getText(returnStatement.argument);
}

/**
 * Gets the body text for formatting based on options.
 */
function getBodyForFormat(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): string | null {
	if (options.implicit) {
		// Get implicit return format
		if (node.body.type === "BlockStatement") {
			// Extract return value from block
			const returnStatement = node.body.body.find(
				(stmt): stmt is TSESTree.ReturnStatement => stmt.type === "ReturnStatement",
			);

			if (!returnStatement || !returnStatement.argument) {
				return null;
			}

			const returnValue = returnStatement.argument;
			const returnText = sourceCode.getText(returnValue);

			// Wrap object literals in parens
			if (returnValue.type === "ObjectExpression") {
				return `(${returnText})`;
			}

			return returnText;
		}

		// Already implicit
		const bodyText = sourceCode.getText(node.body);

		// Wrap object literals in parens
		if (node.body.type === "ObjectExpression") {
			return `(${bodyText})`;
		}

		return bodyText;
	} else {
		// Get explicit return format
		if (node.body.type === "BlockStatement") {
			// Already explicit
			return sourceCode.getText(node.body);
		}

		// Convert implicit to explicit
		const bodyText = sourceCode.getText(node.body);
		return `{ return ${bodyText}; }`;
	}
}

/**
 * Gets the parameters text from an arrow function.
 */
function getParameters(node: TSESTree.ArrowFunctionExpression, sourceCode: TSESLint.SourceCode): string {
	const nodeText = sourceCode.getText(node);
	const arrowIndex = nodeText.indexOf(" => ");

	if (arrowIndex === -1) {
		// Fallback: return params directly
		return node.params.map((p) => sourceCode.getText(p)).join(", ");
	}

	return nodeText.substring(0, arrowIndex).trim();
}
