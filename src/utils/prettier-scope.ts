/* eslint-disable ts/no-unnecessary-condition, ts/strict-boolean-expressions -- Type guards needed for runtime safety despite TypeScript's narrowing */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from "@typescript-eslint/utils";

import type { Options as PrettierOptions } from "prettier";

import { formatWithPrettier, type PrettierFormatResult } from "./prettier-format.js";

/** Defines the scope/context in which code should be formatted for analysis. */
export enum FormattingScope {
	/**
	 * Format the block body (for block-to-implicit conversion). Example: `{
	 * return x + 1; }` → `x + 1`.
	 */
	BlockBody = "block_body",

	/**
	 * Format in its inline context (method chain, call expression, etc.).
	 * Example: `.map((x) => x + 1)`.
	 */
	InlineContext = "inline_context",

	/** Format just the arrow function in isolation. Example: `(x) => x + 1`. */
	Snippet = "snippet",

	/**
	 * Format as a complete statement (variable declaration, assignment, etc.).
	 * Example: `const fn = (x) => x + 1;`.
	 */
	Statement = "statement",
}

interface ScopeExtractionOptions {
	/** Whether to extract as implicit return (without braces/return keyword). */
	implicit: boolean;

	/** Prettier configuration to use for formatting. */
	prettierOptions?: PrettierOptions;
}

interface ScopeExtractionResult {
	/** The code that was formatted. */
	code: string;

	/** The formatting result from Prettier. */
	result: PrettierFormatResult;

	/** The scope that was used for extraction. */
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
// eslint-disable-next-line better-max-params/better-max-params -- Public API function, changing would be breaking
export function extractAtScope(
	node: TSESTree.ArrowFunctionExpression,
	scope: FormattingScope,
	sourceCode: TSESLint.SourceCode,
	context: TSESLint.RuleContext<any, any>,
	options: ScopeExtractionOptions,
): null | ScopeExtractionResult {
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

function buildBlockBody(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	_options: ScopeExtractionOptions,
): null | string {
	if (node.body.type !== AST_NODE_TYPES.BlockStatement) {
		// Already an expression body
		return sourceCode.getText(node.body);
	}

	// Find return statement
	const returnStatement = node.body.body.find(
		(stmt): stmt is TSESTree.ReturnStatement => stmt.type === AST_NODE_TYPES.ReturnStatement,
	);

	if (!returnStatement?.argument) {
		return null;
	}

	return sourceCode.getText(returnStatement.argument);
}

/**
 * Builds the code string for a specific scope.
 *
 * @param node - The arrow function expression node to build code for.
 * @param scope - The formatting scope (block body, inline context, snippet, or
 *   statement).
 * @param sourceCode - The ESLint source code object for text extraction.
 * @param options - Extraction options controlling implicit/explicit formatting.
 * @returns The code string in the requested scope, or null if it cannot be
 *   built.
 */
function buildCodeForScope(
	node: TSESTree.ArrowFunctionExpression,
	scope: FormattingScope,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	switch (scope) {
		case FormattingScope.BlockBody: {
			return buildBlockBody(node, sourceCode, options);
		}
		case FormattingScope.InlineContext: {
			return buildInlineContext(node, sourceCode, options);
		}
		case FormattingScope.Snippet: {
			return buildSnippet(node, sourceCode, options);
		}
		case FormattingScope.Statement: {
			return buildStatement(node, sourceCode, options);
		}
		default: {
			return null;
		}
	}
}

/**
 * Builds code for INLINE_CONTEXT scope - method chain or call expression
 * context.
 *
 * @param node - The arrow function expression node.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options controlling formatting.
 * @returns The code formatted in inline context (e.g., `.map(x => x + 1)`), or
 *   null if unable.
 */
function buildInlineContext(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	const { parent } = node;

	if (!parent || parent.type !== AST_NODE_TYPES.CallExpression) {
		return buildSnippet(node, sourceCode, options);
	}

	// Method chain: .map(() => ...)
	if (parent.callee.type === AST_NODE_TYPES.MemberExpression) {
		const methodName = sourceCode.getText(parent.callee.property);
		const body = getBodyForFormat(node, sourceCode, options);

		if (body === null) {
			return null;
		}

		const parameters = getParameters(node, sourceCode);
		return `placeholder.${methodName}(${parameters} => ${body})`;
	}

	// Function call: useCallback(() => ...)
	const functionName = sourceCode.getText(parent.callee);
	const body = getBodyForFormat(node, sourceCode, options);

	if (body === null) {
		return null;
	}

	const parameters = getParameters(node, sourceCode);
	return `${functionName}(${parameters} => ${body})`;
}

/**
 * Builds a property statement.
 *
 * @param node - The arrow function node.
 * @param parent - The parent property node containing the arrow function.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options.
 * @returns Property object literal string (e.g., `{ key: x => x + 1 }`), or
 *   null if unable.
 */
function buildPropertyStatement(
	node: TSESTree.ArrowFunctionExpression,
	parent: TSESTree.Property,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	const key = sourceCode.getText(parent.key);
	const body = getBodyForFormat(node, sourceCode, options);
	if (body === null) {
		return null;
	}

	const parameters = getParameters(node, sourceCode);
	const separator = parent.computed ? ":" : ": ";
	return `{ ${key}${separator}${parameters} => ${body} }`;
}

/**
 * Builds code for SNIPPET scope - just the arrow function in isolation.
 *
 * @param node - The arrow function expression node.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options controlling formatting.
 * @returns The arrow function as a standalone snippet (e.g., `x => x + 1`), or
 *   null if unable.
 */
function buildSnippet(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
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
 *
 * @param node - The arrow function expression node.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options controlling formatting.
 * @returns The arrow function in statement context (e.g., `const fn = x => x +
 *   1;`), or null if unable.
 */
function buildStatement(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	const { parent } = node;
	if (!parent) {
		return buildSnippet(node, sourceCode, options);
	}

	// Variable declaration: const fn = () => ...
	if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === node) {
		return buildVariableDeclaration(node, parent, sourceCode, options);
	}

	// Return statement: return () => ...
	if (parent.type === AST_NODE_TYPES.ReturnStatement) {
		const body = getBodyForFormat(node, sourceCode, options);
		if (body === null) {
			return null;
		}

		const parameters = getParameters(node, sourceCode);
		return `return ${parameters} => ${body};`;
	}

	// Property: { key: () => ... }
	if (parent.type === AST_NODE_TYPES.Property && parent.value === node) {
		return buildPropertyStatement(node, parent, sourceCode, options);
	}

	// Fallback to snippet
	return buildSnippet(node, sourceCode, options);
}

/**
 * Builds a variable declaration statement.
 *
 * @param node - The arrow function node.
 * @param parent - The variable declarator parent.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options.
 * @returns Variable declaration string, or null if unable.
 */
function buildVariableDeclaration(
	node: TSESTree.ArrowFunctionExpression,
	parent: TSESTree.VariableDeclarator,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	const grandparent = parent.parent;
	if (!grandparent || grandparent.type !== AST_NODE_TYPES.VariableDeclaration) {
		return null;
	}

	const declarationKeyword = sourceCode.getFirstToken(grandparent)?.value ?? "const";
	const variableName = sourceCode.getText(parent.id);
	const body = getBodyForFormat(node, sourceCode, options);
	if (body === null) {
		return null;
	}

	const parameters = getParameters(node, sourceCode);
	return `${declarationKeyword} ${variableName} = ${parameters} => ${body};`;
}

/**
 * Extracts implicit return value from block statement.
 *
 * @param node - The arrow function node.
 * @param sourceCode - The ESLint source code object.
 * @returns Implicit return text, or null if unable to extract.
 */
function extractImplicitReturnFromBlock(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
): null | string {
	if (node.body.type !== AST_NODE_TYPES.BlockStatement) {
		return null;
	}

	const returnStatement = node.body.body.find(
		(stmt): stmt is TSESTree.ReturnStatement => stmt.type === AST_NODE_TYPES.ReturnStatement,
	);
	if (!returnStatement?.argument) {
		return null;
	}

	const returnText = sourceCode.getText(returnStatement.argument);
	return returnStatement.argument.type === AST_NODE_TYPES.ObjectExpression
		? `(${returnText})`
		: returnText;
}

/**
 * Gets the body text for formatting based on options.
 *
 * @param node - The arrow function expression node.
 * @param sourceCode - The ESLint source code object.
 * @param options - Extraction options (determines implicit vs explicit format).
 * @returns The formatted body text (implicit or explicit), or null if unable to
 *   extract.
 */
function getBodyForFormat(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
	options: ScopeExtractionOptions,
): null | string {
	if (options.implicit) {
		// Extract from block statement
		if (node.body.type === AST_NODE_TYPES.BlockStatement) {
			return extractImplicitReturnFromBlock(node, sourceCode);
		}

		// Already implicit - wrap object literals in parens
		const bodyText = sourceCode.getText(node.body);
		return node.body.type === AST_NODE_TYPES.ObjectExpression ? `(${bodyText})` : bodyText;
	}

	// Explicit format - already a block or convert to block
	if (node.body.type === AST_NODE_TYPES.BlockStatement) {
		return sourceCode.getText(node.body);
	}

	return `{ return ${sourceCode.getText(node.body)}; }`;
}

/**
 * Gets the parameters text from an arrow function.
 *
 * @param node - The arrow function expression node.
 * @param sourceCode - The ESLint source code object.
 * @returns The parameter list as a string (e.g., `x`, `(a, b)`, etc.).
 */
function getParameters(
	node: TSESTree.ArrowFunctionExpression,
	sourceCode: TSESLint.SourceCode,
): string {
	const nodeText = sourceCode.getText(node);
	const arrowIndex = nodeText.indexOf(" => ");

	if (arrowIndex === -1) {
		// Fallback: return params directly
		return node.params.map((parameter) => sourceCode.getText(parameter)).join(", ");
	}

	return nodeText.substring(0, arrowIndex).trim();
}
