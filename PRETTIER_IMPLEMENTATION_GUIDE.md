# Implementation Guide: From Patch-Based to Systematic Prettier Integration

## File Structure Overview

```
Current State:
src/utils/prettier-format.ts              # Main interface (snippet-based)
workers/prettier-worker.ts                # Worker (limited metrics)
src/rules/arrow-return-style/rule.ts      # Multiple context builders

Proposed Structure:
src/utils/prettier-format.ts              # Keep interface, enhance it
src/utils/prettier-metrics.ts            # NEW: Comprehensive metrics
src/utils/prettier-config.ts             # NEW: Configuration analysis
src/utils/prettier-validator.ts          # NEW: Multi-path validation
src/utils/prettier-scope.ts              # NEW: Scope-based formatting
workers/prettier-worker.ts               # Enhance metrics return
src/rules/arrow-return-style/rule.ts     # Simplify, use new utils
```

## Issue 1: Limited Metrics Extraction

### Current Code (workers/prettier-worker.ts:65-73)

```typescript
// Current: Only first line length
const lines = formatted.trim().split("\n");
const isMultiline = lines.length > 1;
const lineLength = lines[0]?.length ?? 0;

return {
  formatted: formatted.trim(),
  isMultiline,
  lineLength,
  success: true,
};
```

### Problem
- Only captures first line length
- Doesn't track where line breaks occur
- No information about multiline structure
- Can't distinguish "long in context" from "long in isolation"

### Solution: Comprehensive Metrics

```typescript
// NEW: workers/prettier-worker.ts

interface DetailedFormatResult extends FormatResult {
  allLineLengths: number[];
  maxLineLength: number;
  avgLineLength: number;
  totalLines: number;
  hasComments: boolean;
  hasJSX: boolean;
  roundTripValid?: boolean;
  parser: string;
}

interface FormatResult {
  formatted: string;
  isMultiline: boolean;
  lineLength: number;
  // NEW fields
  allLineLengths: number[];
  maxLineLength: number;
  avgLineLength: number;
  totalLines: number;
  hasComments: boolean;
  hasJSX: boolean;
  parser: string;
  success: true;
}

async function handleFormatRequest(request: FormatRequest): Promise<FormatResult> {
  if (!prettier) {
    throw new Error("Prettier not loaded");
  }

  let config = await prettier.resolveConfig(request.filePath ?? "package.json", {
    editorconfig: true,
  });

  if (request.configOverride) {
    config = { ...config, ...request.configOverride };
  }

  const formatted = await prettier.format(request.code, {
    ...config,
    filepath: request.filePath,
  });

  // Enhanced metrics extraction
  const trimmedFormatted = formatted.trim();
  const lines = trimmedFormatted.split("\n");
  const allLineLengths = lines.map(line => line.length);
  const maxLineLength = Math.max(...allLineLengths, 0);
  const avgLineLength = allLineLengths.reduce((a, b) => a + b, 0) / allLineLengths.length;

  // Detect comments and JSX
  const hasComments = /\/\*|\/\/|<!--|{\/\*/.test(trimmedFormatted);
  const hasJSX = /<[A-Z]|<\/|<>|<\/>/.test(trimmedFormatted);

  // Detect parser
  const fileInfo = await prettier.getFileInfo(request.filePath ?? "package.json");
  const parser = fileInfo?.parser ?? config?.parser ?? 'babel';

  // Validate roundtrip (optional but useful for debugging)
  let roundTripValid = true;
  try {
    const doubleFormatted = await prettier.format(trimmedFormatted, {
      ...config,
      filepath: request.filePath,
    });
    roundTripValid = doubleFormatted.trim() === trimmedFormatted;
  } catch {
    roundTripValid = false;
  }

  return {
    formatted: trimmedFormatted,
    isMultiline: lines.length > 1,
    lineLength: lines[0]?.length ?? 0,
    // New metrics
    allLineLengths,
    maxLineLength,
    avgLineLength,
    totalLines: lines.length,
    hasComments,
    hasJSX,
    parser,
    roundTripValid,
    success: true,
  };
}
```

## Issue 2: Multiple Context-Specific Builders

### Current Problem (rule.ts)

```typescript
// Four different builders for same task:
function buildPrettierCode(...)        // Line 162
function buildIsolatedArrowFunction(...)  // Line 139
function buildCallExpressionContext(...) // Line 84
function buildConvertedArrowFunction(...) // Line 111
```

**Each builder**:
- Is similar but slightly different
- Handles one scenario specifically
- Hard to test independently
- Difficult to reason about coverage

### Solution: Scope-Based Formatting

```typescript
// NEW: src/utils/prettier-scope.ts

export enum FormattingScope {
  /**
   * Just the arrow function expression
   * "(x) => x + 1"
   */
  SNIPPET = 'snippet',
  
  /**
   * Complete statement
   * "const fn = (x) => x + 1;"
   */
  STATEMENT = 'statement',
  
  /**
   * Full line with context
   * ".map((x) => x + 1)"
   */
  INLINE_CONTEXT = 'inline-context',
  
  /**
   * Block statement body
   * "{ return x + 1; }"
   */
  BLOCK_BODY = 'block-body',
}

interface ScopeExtractionResult {
  code: string;
  scope: FormattingScope;
  sourceCode: SourceCode;
  startIndex: number;
  endIndex: number;
}

/**
 * Extract code at specified scope
 */
export function extractAtScope(
  node: ArrowFunctionExpression,
  scope: FormattingScope,
  sourceCode: SourceCode,
  options: { implicit?: boolean } = {},
): ScopeExtractionResult {
  const { implicit = false } = options;

  switch (scope) {
    case FormattingScope.SNIPPET:
      return extractSnippet(node, sourceCode, implicit);
    
    case FormattingScope.STATEMENT:
      return extractStatement(node, sourceCode, implicit);
    
    case FormattingScope.INLINE_CONTEXT:
      return extractInlineContext(node, sourceCode, implicit);
    
    case FormattingScope.BLOCK_BODY:
      return extractBlockBody(node, sourceCode, implicit);
    
    default:
      const _: never = scope;
      throw new Error(`Unknown scope: ${scope}`);
  }
}

function extractSnippet(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  implicit: boolean,
): ScopeExtractionResult {
  const nodeText = sourceCode.getText(node);
  const arrowIndex = nodeText.indexOf(" => ");
  
  if (arrowIndex === -1) {
    throw new Error("Could not find arrow in function");
  }

  const parameters = nodeText.substring(0, arrowIndex);
  
  if (implicit && node.body.type !== 'BlockStatement') {
    const returnValueText = sourceCode.getText(node.body);
    const implicitText = node.body.type === 'ObjectExpression'
      ? `(${returnValueText})`
      : returnValueText;
    
    const code = `${parameters} => ${implicitText}`;
    return {
      code,
      scope: FormattingScope.SNIPPET,
      sourceCode,
      startIndex: node.range[0],
      endIndex: node.range[1],
    };
  }

  if (!implicit && node.body.type === 'BlockStatement') {
    return {
      code: nodeText,
      scope: FormattingScope.SNIPPET,
      sourceCode,
      startIndex: node.range[0],
      endIndex: node.range[1],
    };
  }

  // Need to convert
  if (implicit && node.body.type === 'BlockStatement') {
    const returnValue = extractReturnValue(node.body, sourceCode);
    if (returnValue) {
      const implicitText = returnValue.type === 'ObjectExpression'
        ? `(${sourceCode.getText(returnValue)})`
        : sourceCode.getText(returnValue);
      
      const code = `${parameters} => ${implicitText}`;
      return {
        code,
        scope: FormattingScope.SNIPPET,
        sourceCode,
        startIndex: node.range[0],
        endIndex: node.range[1],
      };
    }
  }

  return {
    code: nodeText,
    scope: FormattingScope.SNIPPET,
    sourceCode,
    startIndex: node.range[0],
    endIndex: node.range[1],
  };
}

function extractStatement(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  implicit: boolean,
): ScopeExtractionResult {
  // Find the statement containing this arrow function
  let current: Node | undefined = node;
  while (current && !isStatement(current)) {
    current = current.parent;
  }

  if (!current) {
    // Fall back to snippet
    return extractSnippet(node, sourceCode, implicit);
  }

  const statementText = sourceCode.getText(current);
  // If we need implicit, convert within the statement
  if (implicit && node.body.type === 'BlockStatement') {
    // Replace the function part in the statement
    const arrowFunctionText = sourceCode.getText(node);
    const parameters = arrowFunctionText.substring(0, arrowFunctionText.indexOf(" => "));
    const returnValue = extractReturnValue(node.body, sourceCode);
    
    if (returnValue) {
      const implicitText = returnValue.type === 'ObjectExpression'
        ? `(${sourceCode.getText(returnValue)})`
        : sourceCode.getText(returnValue);
      
      const convertedFunction = `${parameters} => ${implicitText}`;
      const modifiedStatement = statementText.replace(arrowFunctionText, convertedFunction);
      
      return {
        code: modifiedStatement,
        scope: FormattingScope.STATEMENT,
        sourceCode,
        startIndex: current.range[0],
        endIndex: current.range[1],
      };
    }
  }

  return {
    code: statementText,
    scope: FormattingScope.STATEMENT,
    sourceCode,
    startIndex: current.range[0],
    endIndex: current.range[1],
  };
}

function extractInlineContext(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  implicit: boolean,
): ScopeExtractionResult {
  // Get the line containing the arrow
  const arrowToken = getArrowToken(node, sourceCode);
  if (!arrowToken) {
    return extractSnippet(node, sourceCode, implicit);
  }

  const lineStart = sourceCode.getIndexFromLoc({
    column: 0,
    line: arrowToken.loc.start.line,
  });

  if (typeof lineStart !== 'number') {
    return extractSnippet(node, sourceCode, implicit);
  }

  const lineEnd = sourceCode.text.indexOf('\n', lineStart);
  const actualEnd = lineEnd === -1 ? sourceCode.text.length : lineEnd;
  let code = sourceCode.text.substring(lineStart, actualEnd);

  if (implicit && node.body.type === 'BlockStatement') {
    const arrowFunctionText = sourceCode.getText(node);
    const parameters = arrowFunctionText.substring(0, arrowFunctionText.indexOf(" => "));
    const returnValue = extractReturnValue(node.body, sourceCode);
    
    if (returnValue) {
      const implicitText = returnValue.type === 'ObjectExpression'
        ? `(${sourceCode.getText(returnValue)})`
        : sourceCode.getText(returnValue);
      
      const convertedFunction = `${parameters} => ${implicitText}`;
      code = code.replace(arrowFunctionText, convertedFunction);
    }
  }

  return {
    code: code.trim(),
    scope: FormattingScope.INLINE_CONTEXT,
    sourceCode,
    startIndex: lineStart,
    endIndex: actualEnd,
  };
}

function extractBlockBody(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  implicit: boolean,
): ScopeExtractionResult {
  if (node.body.type !== 'BlockStatement') {
    throw new Error('Node body is not a block statement');
  }

  if (implicit) {
    // Convert to implicit first
    const parameters = sourceCode.getText(node).split(' => ')[0];
    const returnValue = extractReturnValue(node.body, sourceCode);
    
    if (returnValue) {
      const implicitText = returnValue.type === 'ObjectExpression'
        ? `(${sourceCode.getText(returnValue)})`
        : sourceCode.getText(returnValue);
      
      return {
        code: `${parameters} => ${implicitText}`,
        scope: FormattingScope.SNIPPET,
        sourceCode,
        startIndex: node.range[0],
        endIndex: node.range[1],
      };
    }
  }

  const code = sourceCode.getText(node.body);
  return {
    code,
    scope: FormattingScope.BLOCK_BODY,
    sourceCode,
    startIndex: node.body.range[0],
    endIndex: node.body.range[1],
  };
}

function isStatement(node: Node): boolean {
  return node.type.endsWith('Statement') || node.type.endsWith('Declaration');
}

function extractReturnValue(
  blockStatement: BlockStatement,
  sourceCode: SourceCode,
): Expression | undefined {
  const body = blockStatement.body;
  if (body.length === 1 && body[0]?.type === 'ReturnStatement') {
    return body[0].argument ?? undefined;
  }
  return undefined;
}

function getArrowToken(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
): Token | undefined {
  return sourceCode.getTokens(node).find((t) => t.value === '=>');
}
```

## Issue 3: No Multi-Path Validation

### Current Decision Logic (rule.ts:225-242)

```typescript
function calcPrettierImplicitLength(...) {
  // Only checks ONE path: the implicit version
  const prettierResult = formatWithPrettier(implicitArrowFunction, context, prettierOptions);
  if (prettierResult.error !== undefined) {
    return createPrettierFallbackResult(returnValue, sourceCode, node);
  }

  return {
    isMultiline: prettierResult.isMultiline,
    length: prettierResult.lineLength,
  };
}
```

### Problem
- Only formats implicit version
- Doesn't explore alternatives
- Can't detect conflicting preferences
- No validation of fallback behavior

### Solution: Multi-Path Validation

```typescript
// NEW: src/utils/prettier-validator.ts

export interface FormattingDecisionContext {
  node: ArrowFunctionExpression;
  sourceCode: SourceCode;
  prettierConfig: PrettierOptions;
  ruleOptions: RuleOptions;
  
  // Prevalidated paths
  implicitMetrics: PrettierMetrics;
  explicitMetrics: PrettierMetrics;
  
  // Scope variants
  snippetMetrics: PrettierMetrics;
  statementMetrics: PrettierMetrics;
  
  // Validation results
  decisions: {
    canBeImplicit: boolean;
    canBeExplicit: boolean;
    implicitshorterInSnippet: boolean;
    implicitShorterInContext: boolean;
    conflictDetected: boolean;
  };
}

export async function prevalidateFormattingPaths(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  prettierConfig: PrettierOptions,
  ruleOptions: RuleOptions,
): Promise<FormattingDecisionContext> {
  // Format implicit version in different scopes
  const implicitSnippet = extractAtScope(node, FormattingScope.SNIPPET, sourceCode, {
    implicit: true,
  });
  const implicitStatementScope = extractAtScope(node, FormattingScope.STATEMENT, sourceCode, {
    implicit: true,
  });

  // Format explicit version
  const explicitSnippet = extractAtScope(node, FormattingScope.SNIPPET, sourceCode, {
    implicit: false,
  });
  const explicitStatement = extractAtScope(node, FormattingScope.STATEMENT, sourceCode, {
    implicit: false,
  });

  // Get metrics for each
  const implicitMetricsSnippet = await formatWithPrettier(implicitSnippet.code, prettierConfig);
  const implicitMetricsStatement = await formatWithPrettier(implicitStatementScope.code, prettierConfig);
  const explicitMetricsSnippet = await formatWithPrettier(explicitSnippet.code, prettierConfig);
  const explicitMetricsStatement = await formatWithPrettier(explicitStatement.code, prettierConfig);

  // Determine validity
  const canBeImplicit = implicitMetricsSnippet.maxLineLength <= ruleOptions.maxLen;
  const canBeExplicit = true; // Always valid

  // Check for conflicts
  const implicitShorterInSnippet = implicitMetricsSnippet.lineLength < explicitMetricsSnippet.lineLength;
  const implicitShorterInContext = implicitMetricsStatement.maxLineLength < explicitMetricsStatement.maxLineLength;

  const conflictDetected = 
    canBeImplicit && 
    !implicitShorterInSnippet && 
    !implicitShorterInContext;

  return {
    node,
    sourceCode,
    prettierConfig,
    ruleOptions,
    
    implicitMetrics: implicitMetricsSnippet,
    explicitMetrics: explicitMetricsSnippet,
    
    snippetMetrics: implicitMetricsSnippet,
    statementMetrics: implicitMetricsStatement,
    
    decisions: {
      canBeImplicit,
      canBeExplicit,
      implicitshorterInSnippet: implicitShorterInSnippet,
      implicitShorterInContext: implicitShorterInContext,
      conflictDetected,
    },
  };
}

export function makeDecisionFromContext(
  context: FormattingDecisionContext,
): 'implicit' | 'explicit' {
  // Use all validated information
  const { decisions, ruleOptions, implicitMetrics, explicitMetrics } = context;

  // If implicit doesn't fit in any scope, use explicit
  if (!decisions.canBeImplicit) {
    return 'explicit';
  }

  // If there's a conflict, prefer explicit (safer)
  if (decisions.conflictDetected) {
    return 'explicit';
  }

  // If explicit formatting error, use implicit
  if (explicitMetrics.error) {
    return 'implicit';
  }

  // If implicit is clearly shorter and valid, use it
  if (decisions.implicitshorterInSnippet && decisions.implicitShorterInContext) {
    return 'implicit';
  }

  // Default to explicit for safety
  return 'explicit';
}
```

## Issue 4: Missing Configuration Analysis

### Current State (prettier-format.ts)

```typescript
// Config is resolved but not analyzed
const config = resolvePrettierConfigOptions(filePath);
// Then just spread it: { ...config, filepath: ... }
```

### Solution: Configuration Analysis

```typescript
// NEW: src/utils/prettier-config.ts

export interface PrettierConfigAnalysis {
  // Core formatting
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  
  // Object/array formatting
  bracketSpacing: boolean;
  bracketSameLine: boolean;
  trailingComma: 'es5' | 'none' | 'all';
  
  // Arrow functions
  arrowParens: 'always' | 'avoid';
  
  // JSX
  jsxBracketSameLine: boolean;
  jsxSingleQuote: boolean;
  
  // Quotes
  singleQuote: boolean;
  quoteProps: 'as-needed' | 'consistent' | 'preserve';
  
  // Semicolons
  semi: boolean;
  
  // Edge cases
  proseWrap: 'always' | 'never' | 'preserve';
  requirePragma: boolean;
  insertPragma: boolean;
  
  // Metadata
  source: 'user' | 'editorconfig' | 'cli' | 'default';
  parser: string;
}

export function analyzePrettierConfig(
  config: PrettierOptions | null | undefined,
): PrettierConfigAnalysis {
  return {
    printWidth: config?.printWidth ?? 80,
    tabWidth: config?.tabWidth ?? 2,
    useTabs: config?.useTabs ?? false,
    
    bracketSpacing: config?.bracketSpacing ?? true,
    bracketSameLine: config?.bracketSameLine ?? false,
    trailingComma: config?.trailingComma ?? 'es5',
    
    arrowParens: config?.arrowParens ?? 'always',
    
    jsxBracketSameLine: config?.jsxBracketSameLine ?? false,
    jsxSingleQuote: config?.jsxSingleQuote ?? false,
    
    singleQuote: config?.singleQuote ?? false,
    quoteProps: config?.quoteProps ?? 'as-needed',
    
    semi: config?.semi ?? true,
    
    proseWrap: config?.proseWrap ?? 'preserve',
    requirePragma: config?.requirePragma ?? false,
    insertPragma: config?.insertPragma ?? false,
    
    source: detectConfigSource(config),
    parser: config?.parser ?? 'babel',
  };
}

/**
 * Use config analysis to inform decisions
 */
export function getConfigImpact(
  analysis: PrettierConfigAnalysis,
  code: string,
): {
  affectsLineLength: boolean;
  affectsMultiline: boolean;
  affectsFormatting: boolean;
} {
  const hasObjects = code.includes('{');
  const hasArrays = code.includes('[');
  const hasArrowParams = code.includes('=>');

  return {
    affectsLineLength: true, // printWidth always affects
    affectsMultiline: 
      hasObjects && !analysis.bracketSpacing ||
      hasArrays && analysis.trailingComma !== 'none' ||
      hasArrowParams && analysis.arrowParens === 'always',
    affectsFormatting:
      analysis.singleQuote ||
      analysis.semi === false ||
      analysis.trailingComma !== 'es5',
  };
}

function detectConfigSource(config: any): PrettierConfigAnalysis['source'] {
  if (!config) return 'default';
  if (config._source === 'editorconfig') return 'editorconfig';
  if (config._source === 'cli') return 'cli';
  if (config._source === 'user') return 'user';
  return 'default';
}
```

## Summary of Changes

| Issue | Current | Solution |
|-------|---------|----------|
| Limited metrics | First line only | All lines, max, avg, structural info |
| Multiple builders | 4 context-specific functions | Unified scope-based extraction |
| No prevalidation | Single path | Multi-path with decision context |
| Config ignored | Spread as-is | Analyzed and utilized |
| Test gaps | 29 Prettier tests | 100+ with variants |
| Debugging | Implicit logic | Explicit decision matrices |

## Migration Path

1. **Phase 1**: Add new utility files (prettier-metrics.ts, prettier-config.ts, etc.)
2. **Phase 2**: Enhance prettier-format.ts to use new utilities
3. **Phase 3**: Update rule.ts to use scope-based extraction
4. **Phase 4**: Migrate to prevalidation pattern
5. **Phase 5**: Remove old context builders
6. **Phase 6**: Add comprehensive tests

Each phase is independent and can be reviewed/tested separately.
