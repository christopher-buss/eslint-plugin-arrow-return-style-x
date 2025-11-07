# ESLint Arrow Return Style: Making Prettier Integration More Robust

## Executive Summary

The current Prettier-based approach relies on **snippet formatting** with **context-specific builders**. While functional, it's fragile and patch-based. A more robust, systematic approach would leverage Prettier's full API capabilities and prevalidation strategies.

## Current State Analysis

### How Prettier Is Currently Used (Snippet-Based)

```
Current Flow:
1. Build isolated code snippet (e.g., "() => returnValue")
2. Call prettier.format(snippet)
3. Extract metrics: lineLength, isMultiline
4. Compare against maxLen threshold
5. Make decision based on single formatted output
```

**Key Areas:**
- `/src/utils/prettier-format.ts` - Worker interface
- `/workers/prettier-worker.ts` - Prettier wrapper
- `buildPrettierCode()`, `buildIsolatedArrowFunction()`, etc. - Context-specific builders
- **29 test cases** involve Prettier (mostly printWidth tests)

### Issues with Current Approach

1. **Multiple Context Builders**: Different code is formatted for different scenarios
   - `buildPrettierCode()` - Complex expressions with method chains
   - `buildIsolatedArrowFunction()` - Standalone arrow functions
   - `buildCallExpressionContext()` - Call expressions
   - `buildConvertedArrowFunction()` - Return statements
   
2. **Limited Metrics Extraction**: Only using formatted text and line length
   - `lineLength = lines[0]?.length ?? 0` - Just first line
   - `isMultiline = lines.length > 1` - Basic detection
   - No parsing information, comment handling, or bracket tracking

3. **No Validation Against Possibilities**: Making decisions on single snapshot
   - Only formatting one specific code variant
   - Not exploring what Prettier would do with alternatives
   - No fallback validation if formatting changes unexpectedly

4. **Missing Prettier Features**:
   - `prettier.getFileInfo()` - Parser detection
   - `prettier.check()` - Validation without modification
   - Full `ParserOptions` utilization
   - Range formatting with `prettier.formatRange()` (via API)
   - Error handling for unparseable code

## Recommendations for Systematic Approach

### 1. Comprehensive Prettier API Usage

#### Current Usage:
```typescript
// Only format and extract basic info
const formatted = await prettier.format(code, {
  ...config,
  filepath: request.filePath,
});
const lines = formatted.trim().split("\n");
const lineLength = lines[0]?.length ?? 0;
```

#### Recommended Approach:
```typescript
interface PrettierMetrics {
  formatted: string;
  original: string;
  
  // First-line metrics
  firstLineLength: number;
  isMultiline: boolean;
  
  // Extended metrics
  allLineLengths: number[];
  maxLineLength: number;
  totalLines: number;
  
  // Parsing info
  parser: string;
  hasComments: boolean;
  hasJSX: boolean;
  
  // Verification
  roundTripValid: boolean;
  options: PrettierOptions;
}
```

**Implementation:**
1. Use `prettier.getFileInfo()` to detect parser automatically
2. Format code and inspect result more thoroughly
3. Store all line lengths, not just first
4. Detect if formatted output differs from input
5. Validate formatting is reversible (roundtrip)

### 2. Format Entire Context vs. Snippets

#### Current: Snippet formatting
```typescript
// buildPrettierCode() returns only the arrow function
"(param) => implicitReturnText"
// Then prettier formats just this snippet
```

#### Recommended: Contextual formatting
```typescript
/**
 * Format at different granularity levels
 */
enum FormattingScope {
  SNIPPET,        // Just the arrow function (current)
  STATEMENT,      // Full statement containing the arrow function
  DECLARATION,    // Full variable/property declaration
  FULL_CONTEXT,   // Surrounding code context
}

/**
 * Format code at appropriate scope
 */
function formatAtScope(
  node: ArrowFunctionExpression,
  scope: FormattingScope,
  sourceCode: SourceCode,
): PrettierMetrics {
  // Get appropriate text based on scope
  const text = extractAtScope(node, scope, sourceCode);
  
  // Format and extract metrics
  return getPrettierMetrics(text, prettierConfig);
}

// Examples:
formatAtScope(node, FormattingScope.SNIPPET)      // "(x) => x + 1"
formatAtScope(node, FormattingScope.STATEMENT)    // "const fn = (x) => x + 1;"
formatAtScope(node, FormattingScope.DECLARATION)  // "const fn = (x) => x + 1;"
```

**Benefits:**
- Different scopes reveal how Prettier handles the code in context
- STATEMENT scope shows realistic line length
- Detects if code would be reformatted even at higher scope
- Helps distinguish between "long in isolation" vs "long in context"

### 3. Leverage Prettier Configuration Options More Systematically

#### Current Configuration Usage:
```typescript
const config = await prettier.resolveConfig(filePath, {
  editorconfig: true,
});
// Then just spread it: { ...config, filepath: request.filePath }
```

#### Recommended: Configuration Analysis
```typescript
interface PrettierConfigAnalysis {
  // Core metrics
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  
  // Line ending and spacing
  singleQuote: boolean;
  trailingComma: 'es5' | 'none' | 'all';
  bracketSpacing: boolean;
  
  // JSX and special handling
  jsxBracketSameLine: boolean;
  jsxSingleQuote: boolean;
  arrowParens: 'always' | 'avoid';
  
  // Parser-specific
  proseWrap: 'always' | 'never' | 'preserve';
  requirePragma: boolean;
  insertPragma: boolean;
  
  // Plugins
  plugins?: string[];
  overrides?: any[];
  
  // Resolved config metadata
  resolved: boolean;
  source: 'user' | 'editorconfig' | 'cli' | 'default';
}

/**
 * Analyze Prettier config to understand formatting behavior
 */
function analyzePrettierConfig(
  prettierConfig: PrettierOptions,
): PrettierConfigAnalysis {
  return {
    printWidth: prettierConfig.printWidth ?? 80,
    tabWidth: prettierConfig.tabWidth ?? 2,
    useTabs: prettierConfig.useTabs ?? false,
    singleQuote: prettierConfig.singleQuote ?? false,
    trailingComma: prettierConfig.trailingComma ?? 'es5',
    bracketSpacing: prettierConfig.bracketSpacing ?? true,
    jsxBracketSameLine: prettierConfig.jsxBracketSameLine ?? false,
    jsxSingleQuote: prettierConfig.jsxSingleQuote ?? false,
    arrowParens: prettierConfig.arrowParens ?? 'always',
    // ... analyze other options
  };
}
```

**Usage in Decision Making:**
```typescript
function makeFormattingDecision(
  node: ArrowFunctionExpression,
  config: PrettierConfigAnalysis,
  metrics: PrettierMetrics,
): 'implicit' | 'explicit' {
  // arrowParens affects parentheses around single params
  // bracketSpacing affects object formatting
  // trailingComma affects multiline structures
  // Use this info to make better predictions
}
```

### 4. Pre-Validate Against All Possible Prettier Outputs

#### Current: Single path decision
```typescript
// Format implicit version, check if it fits
const implicitMetrics = formatWithPrettier(implicitCode, config);
if (implicitMetrics.length > maxLen) {
  // Must use explicit return
  return 'explicit';
}
```

#### Recommended: Multi-path validation
```typescript
interface FormattingDecisionContext {
  implicitMetrics: PrettierMetrics;
  explicitMetrics: PrettierMetrics;
  explicitMultilineMetrics: PrettierMetrics;
  
  // Different Prettier versions
  fallbackMetrics: PrettierMetrics;
  
  // Validation results
  implicitsValid: boolean;
  explicitValid: boolean;
  multilineExplicitValid: boolean;
}

/**
 * Prevalidate all possible formatting paths
 */
function prevalidateFormattingPaths(
  node: ArrowFunctionExpression,
  sourceCode: SourceCode,
  prettierConfig: PrettierOptions,
): FormattingDecisionContext {
  const context: FormattingDecisionContext = {
    // Test implicit return
    implicitMetrics: formatWithPrettier(
      buildIsolatedArrowFunction(node),
      prettierConfig,
    ),
    
    // Test explicit return
    explicitMetrics: formatWithPrettier(
      buildExplicitReturnBlock(node),
      prettierConfig,
    ),
    
    // Test multiline explicit
    explicitMultilineMetrics: formatWithPrettier(
      buildMultilineExplicitReturnBlock(node),
      prettierConfig,
    ),
    
    // Test fallback (no Prettier)
    fallbackMetrics: createManualMetrics(node, sourceCode),
    
    // Validation
    implicitsValid: validateImplicitReturnSafety(implicitMetrics),
    explicitValid: validateExplicitReturnSafety(explicitMetrics),
    multilineExplicitValid: validateExplicitReturnSafety(explicitMultilineMetrics),
  };
  
  return context;
}

/**
 * Make decision based on all prevalidated paths
 */
function decideBestReturnStyle(
  context: FormattingDecisionContext,
  maxLen: number,
  options: RuleOptions,
): 'implicit' | 'explicit' {
  // Compare all valid options
  // Choose the most readable one
  // Fall back to explicit if uncertain
}
```

**Benefits:**
- Explores all formatting possibilities upfront
- Detects conflicts between different approaches
- More predictable decisions
- Easy to debug (see all the numbers)

### 5. Use Prettier's Internal Parsing Information

#### Current: Just formatted text
```typescript
const formatted = await prettier.format(code, config);
// Extract only: lines, lineLength
```

#### Recommended: Leverage Parsing
```typescript
/**
 * More comprehensive metrics from parsing
 */
interface DetailedPrettierMetrics extends PrettierMetrics {
  // Structural info (from formatted text analysis)
  hasLineBreaks: boolean;
  breakPoints: {
    afterOpenBracket: boolean;
    beforeCloseBracket: boolean;
    insideObject: boolean;
    insideArray: boolean;
    insideChain: boolean;
  };
  
  // Token distribution
  tokenCount: number;
  operatorCount: number;
  functionCallCount: number;
  nestedLevels: number;
  
  // Comment distribution
  comments: {
    count: number;
    types: ('line' | 'block')[];
    positions: 'before' | 'after' | 'inline'[];
  };
  
  // Readability metrics
  avgLineLength: number;
  maxLineLength: number;
  lineVariance: number;  // How much lines vary in length
}

/**
 * Extract detailed metrics from formatted output
 */
function extractDetailedMetrics(
  original: string,
  formatted: string,
  prettierConfig: PrettierOptions,
): DetailedPrettierMetrics {
  // Parse formatted output
  // Track structure, comments, tokens
  // Calculate derived metrics
  return {
    ...baseMetrics,
    hasLineBreaks: formatted.includes('\n'),
    breakPoints: analyzeBreakPoints(formatted),
    tokenCount: countTokens(formatted),
    // ... other metrics
  };
}
```

### 6. Systematic Test Coverage Strategy

#### Current Coverage Gaps:
```
Current tests:
- 29 tests with Prettier
- Mostly testing printWidth variations
- Limited edge cases
- No parser-specific tests
- No round-trip validation tests
```

#### Recommended Test Expansion:

```typescript
/**
 * Configuration variation tests
 */
describe('prettier configuration variations', () => {
  // Test different printWidth values
  test.each([40, 60, 80, 100, 120])(
    'should handle printWidth %i',
    (printWidth) => { /* ... */ }
  );
  
  // Test parser detection
  test.each(['babel', 'typescript', 'espree'])(
    'should work with parser %s',
    (parser) => { /* ... */ }
  );
  
  // Test trailing comma styles
  test.each(['es5', 'none', 'all'])(
    'should handle trailingComma %s',
    (trailingComma) => { /* ... */ }
  );
});

/**
 * Edge case tests
 */
describe('prettier edge cases', () => {
  // Test code that Prettier can't parse
  test('should handle unparseable code gracefully', () => {
    const invalid = '() => {invalid syntax}';
    // Should fall back to non-Prettier logic
  });
  
  // Test roundtrip validity
  test('should produce valid formatted code', () => {
    const code = '() => x + y';
    const formatted = formatWithPrettier(code);
    // Should be able to format again
    const doubleFormatted = formatWithPrettier(formatted.formatted);
    expect(doubleFormatted.formatted).toBe(formatted.formatted);
  });
  
  // Test different code structures
  test.each([
    'simple-literals',
    'method-chains',
    'nested-objects',
    'jsx-elements',
    'type-predicates',
    'complex-ternary',
  ])(
    'should handle %s correctly',
    (codeType) => { /* ... */ }
  );
});

/**
 * Consistency tests
 */
describe('prettier consistency', () => {
  // Test that different code structures produce consistent decisions
  test('should make consistent decisions for similar code', () => {
    const decisions = [
      decide('() => x + y'),
      decide('() => a + b'),
      decide('() => p + q'),
    ];
    // All should be implicit if they fit
    expect(new Set(decisions).size).toBe(1);
  });
  
  // Test that metrics agree
  test('should have consistent metrics across calculation methods', () => {
    const metrics1 = calcPrettierImplicitLength(node);
    const metrics2 = formatWithPrettier(node);
    // Should agree on isMultiline, length
  });
});
```

## Implementation Roadmap

### Phase 1: Enhance Metrics Collection
- [ ] Extend `PrettierFormatResult` with more metrics
- [ ] Capture all line lengths, not just first
- [ ] Detect comments and JSX in formatted output
- [ ] Calculate variance and readability metrics

### Phase 2: Systematic Configuration Analysis
- [ ] Create `PrettierConfigAnalysis` type
- [ ] Extract and analyze all relevant config options
- [ ] Use config info in decision making
- [ ] Document how each config option affects decisions

### Phase 3: Multi-Path Prevalidation
- [ ] Implement `prevalidateFormattingPaths()`
- [ ] Format all possible variants upfront
- [ ] Create decision matrix based on validation
- [ ] Simplify decision logic with prevalidated data

### Phase 4: Formatting Scope Exploration
- [ ] Add `FormattingScope` enum
- [ ] Implement scope extraction logic
- [ ] Test formatting at different scopes
- [ ] Use scope results in decision making

### Phase 5: Enhanced Test Coverage
- [ ] Add configuration variation tests
- [ ] Add parser-specific tests
- [ ] Add roundtrip validation tests
- [ ] Add consistency tests
- [ ] Expand edge case coverage

### Phase 6: Refactor Core Decision Logic
- [ ] Simplify using prevalidated data
- [ ] Remove context-specific builders (use scopes)
- [ ] Consolidate length calculation
- [ ] Improve fallback logic

## Key Benefits of Systematic Approach

| Aspect | Current | Systematic |
|--------|---------|-----------|
| **Metrics** | First line only | All lines, variance, density |
| **Validation** | Single path | All possible paths |
| **Configuration** | Spread as-is | Analyzed and utilized |
| **Test Coverage** | 29 Prettier tests | 100+ with variants |
| **Decision Making** | Context-specific | Unified with prevalidation |
| **Debugging** | Hard (implicit logic) | Easy (explicit matrices) |
| **Maintainability** | Multiple builders | Single scope system |
| **Robustness** | Patch-based fixes | Systematic validation |

## Conclusion

The current Prettier integration works but relies on **context-specific patches** and **single-path decisions**. A systematic approach would:

1. **Use Prettier's full API** - Not just `format()`, but also `getFileInfo()`, validation, and parsing
2. **Format entire contexts** - Use scope-based formatting instead of snippet building
3. **Leverage configuration** - Analyze Prettier config and use it in decisions
4. **Prevalidate all paths** - Explore all formatting possibilities upfront
5. **Extract comprehensive metrics** - Not just line length, but structural info
6. **Expand test coverage** - Cover configuration variations, edge cases, and consistency

This makes the code more **predictable, debuggable, and maintainable** while reducing the need for patches and special cases.
