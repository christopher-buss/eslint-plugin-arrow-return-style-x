# Prettier Integration: Quick Recommendations Summary

## Current State (Patch-Based Approach)

The plugin currently uses **snippet formatting** with multiple context-specific builders:
- `buildPrettierCode()` - For complex expressions
- `buildIsolatedArrowFunction()` - For standalone functions  
- `buildCallExpressionContext()` - For call expressions
- `buildConvertedArrowFunction()` - For return statements

**Issues:**
1. Only captures first line length from Prettier output
2. Four different builder functions for essentially the same task
3. Makes decisions based on single formatting path
4. Prettier config is used but not analyzed
5. No validation of alternative formatting paths
6. Difficult to debug and maintain

---

## Five Key Improvements

### 1. **Comprehensive Metrics** 
Current: `lineLength = lines[0]?.length ?? 0`  
Better: Track all line lengths, max, average, and structural info

```typescript
// Capture from prettier.format():
allLineLengths: number[]
maxLineLength: number
avgLineLength: number
totalLines: number
hasComments: boolean
hasJSX: boolean
parser: string
```

**Benefit:** See the full picture of formatted code, not just first line

---

### 2. **Scope-Based Formatting** (Replace 4 builders with 1 system)
Current: 4 different builder functions  
Better: Single `formatAtScope()` with 4 scopes

```typescript
enum FormattingScope {
  SNIPPET,         // Just: (x) => x + 1
  STATEMENT,       // Full: const fn = (x) => x + 1;
  INLINE_CONTEXT,  // Line: .map((x) => x + 1)
  BLOCK_BODY,      // Body: { return x + 1; }
}

// One function, many contexts
formatAtScope(node, scope, sourceCode, { implicit: true })
```

**Benefits:**
- Consolidates duplicate logic
- Easy to test each scope independently
- Clear what each variant means
- Can compare "works in isolation" vs "works in context"

---

### 3. **Multi-Path Prevalidation** (Instead of single-path decisions)
Current: Format implicit only, check if it fits  
Better: Format all possibilities upfront, compare

```typescript
interface FormattingDecisionContext {
  implicitMetrics: PrettierMetrics
  explicitMetrics: PrettierMetrics
  implicitSnippet: PrettierMetrics
  implicitStatement: PrettierMetrics
  
  decisions: {
    canBeImplicit: boolean
    implicitshorterInSnippet: boolean
    implicitShorterInContext: boolean
    conflictDetected: boolean
  }
}

// Makes all comparisons explicit
decide(context) // vs current: implicit logic spread across 5 functions
```

**Benefits:**
- See all options at once (matrix view)
- Detect contradictions before deciding
- Easy to debug (all numbers visible)
- Fallback logic is explicit

---

### 4. **Configuration Analysis** (Use Prettier config, don't ignore it)
Current: Config resolved but just spread as-is  
Better: Analyze config and use it in decisions

```typescript
interface PrettierConfigAnalysis {
  printWidth: number
  arrowParens: 'always' | 'avoid'  // Affects formatting
  trailingComma: 'es5' | 'none' | 'all'  // Affects multiline
  bracketSpacing: boolean  // Affects object spacing
  // ... 10+ other analyzed options
}

// Use this info:
if (config.arrowParens === 'avoid') {
  // Single-param arrows won't have parens
  // Adjust length calculations
}
```

**Benefits:**
- Parser-aware decisions
- Explains format changes to users
- Future-proof for Prettier config changes

---

### 5. **Systematic Test Coverage** (100+ tests vs current 29 Prettier tests)
Current: 29 tests, mostly printWidth variations  
Better: Comprehensive coverage

```typescript
// Configuration variations
test.each([40, 60, 80, 100, 120])('printWidth %i', ...)
test.each(['babel', 'typescript'])('parser %s', ...)
test.each(['es5', 'none', 'all'])('trailingComma %s', ...)

// Edge cases
test('unparseable code gracefully')
test('roundtrip validity')
test('method chains')
test('nested objects')
test('jsx-elements')

// Consistency
test('similar code produces consistent decisions')
test('metrics agree across calculations')
```

**Benefits:**
- Catches edge cases early
- Documents expected behavior
- Easier regression testing

---

## Implementation Roadmap

### Quick Win (1-2 days)
- [ ] Enhance metrics in `prettier-worker.ts`
- [ ] Add `allLineLengths`, `maxLineLength`, `parser`
- [ ] No changes to rule logic yet

### Medium Term (3-5 days)
- [ ] Create `prettier-scope.ts` with scope-based extraction
- [ ] Create `prettier-config.ts` for configuration analysis
- [ ] Create `prettier-validator.ts` for multi-path validation

### Refactoring (2-3 days)
- [ ] Update `rule.ts` to use new utilities
- [ ] Replace 4 builders with scope extraction
- [ ] Simplify decision logic with prevalidation

### Testing (2-3 days)
- [ ] Add configuration variation tests
- [ ] Add parser-specific tests
- [ ] Add roundtrip validation tests
- [ ] Add consistency tests

**Total estimated effort:** 8-13 days for complete transformation

---

## File Changes Summary

```
NEW FILES (add these):
+ src/utils/prettier-metrics.ts       (Extract comprehensive metrics)
+ src/utils/prettier-config.ts        (Analyze Prettier config)
+ src/utils/prettier-validator.ts     (Multi-path validation)
+ src/utils/prettier-scope.ts         (Scope-based extraction)

MODIFY (enhance existing):
* workers/prettier-worker.ts          (Return more metrics)
* src/utils/prettier-format.ts        (Use new utilities)
* src/rules/arrow-return-style/rule.ts (Simplify, use new utils)

REMOVE/CONSOLIDATE (reduce complexity):
- buildPrettierCode()
- buildIsolatedArrowFunction()
- buildCallExpressionContext()
- buildConvertedArrowFunction()
(Replace with: extractAtScope(node, scope, sourceCode, options))

DELETE (if needed):
- calcPrettierImplicitLength() (old approach)
- calcMethodChainImplicitLength() (old approach)
(Replace with: prevalidateFormattingPaths() + makeDecisionFromContext())
```

---

## Why This Matters

| Metric | Current | After |
|--------|---------|-------|
| Code builders for same task | 4 different functions | 1 scope system |
| Metrics captured | 2 (lineLength, isMultiline) | 11+ (all lines, max, avg, parser, etc) |
| Decision paths explored | 1 (implicit only) | 4+ (implicit/explicit × scopes) |
| Config analyzed | No (just spread) | Yes (12+ options analyzed) |
| Test coverage (Prettier) | 29 tests | 100+ with variants |
| Debugging difficulty | High (implicit logic) | Low (explicit matrices) |
| Lines of decision logic | 200+ scattered | Consolidated <100 |

---

## Key Quote

Current approach: **"Let's format the implicit version and see if it fits"**

Proposed approach: **"Let's format all versions, compare them, and choose the best"**

The systematic approach is:
- More predictable (all options visible)
- More maintainable (less special case code)
- More testable (each scope can be tested independently)
- More debuggable (decision matrix is explicit)
- Less fragile (not patching edge cases)

---

## Next Steps

1. **Review** the two detailed documents:
   - `PRETTIER_ANALYSIS.md` - Full problem analysis
   - `PRETTIER_IMPLEMENTATION_GUIDE.md` - Code examples & solutions

2. **Prioritize** which improvements to tackle first:
   - Start with metrics (low risk, immediate value)
   - Then scopes (refactoring, medium effort)
   - Then validation (decision improvement, medium effort)
   - Finally tests (coverage expansion, medium effort)

3. **Plan sprints** - Each improvement can be worked on independently:
   - Metrics enhancement (day 1-2)
   - Utility functions (day 3-5)
   - Rule refactoring (day 6-7)
   - Test expansion (day 8)

---

## Questions to Consider

- **For metrics:** Should we track comments and JSX detection automatically? ✓ Yes
- **For scopes:** Should we have a 5th scope for "surrounding context"? ✓ Maybe
- **For validation:** Should we cache prevalidation results? ✓ Definitely (performance)
- **For config:** Should we warn users about conflicting Prettier settings? ✓ Nice to have
- **For tests:** Should we support custom Prettier versions? ✓ Yes

---

## References

Full analysis with code examples:
- `PRETTIER_ANALYSIS.md` (16KB) - Deep dive into issues and solutions
- `PRETTIER_IMPLEMENTATION_GUIDE.md` (21KB) - Concrete code examples for each improvement
