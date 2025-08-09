# eslint-plugin-arrow-return-style-x

> Enforce arrow function return style and automatically fix it

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

## Attribution

This project is a fork of
[`eslint-plugin-arrow-return-style`](https://github.com/u3u/eslint-plugin-arrow-return-style)
by [u3u](https://github.com/u3u). The original work provides the foundation for
arrow function return style enforcement, and this fork extends it with
additional features and improvements.

## Features

This ESLint plugin provides intelligent arrow function return style enforcement,
serving as an enhanced alternative to
[`arrow-body-style`](https://eslint.org/docs/latest/rules/arrow-body-style#as-needed)
with smarter heuristics.

### Key Benefits

- **Improved Readability**: Enforces explicit returns for multiline or lengthy
  expressions while keeping simple cases concise
- **Smart JSX Handling**: Optional explicit returns for JSX components to
  facilitate future development
- **Named Export Consistency**: Maintains consistency between arrow functions
  and regular function declarations
- **Automatic Fixes**: Both rules provide comprehensive auto-fixes for seamless
  adoption
- **Debug-Friendly Code**: Anonymous arrow function exports are converted to
  named functions for better stack traces

## Installation

```bash
# npm
npm install eslint-plugin-arrow-return-style-x --save-dev

# pnpm
pnpm add eslint-plugin-arrow-return-style-x -D

# yarn
yarn add eslint-plugin-arrow-return-style-x --dev
```

## Usage

### Flat Config (ESLint 9+)

```js
import arrowReturnStyle from "eslint-plugin-arrow-return-style-x";

export default [
  {
    plugins: {
      "arrow-return-style-x": arrowReturnStyle,
    },
    rules: {
      ...arrowReturnStyle.configs.recommended.rules,
    },
  },
];
```

### Legacy Config (.eslintrc)

```json
{
	"extends": ["plugin:arrow-return-style-x/recommended"]
}
```

## Configuration Options

### `arrow-return-style`

Configure the main rule with these options:

```json
{
	"rules": {
		"arrow-return-style-x/arrow-return-style": ["error", {
			"maxLen": 80,
			"jsxAlwaysUseExplicitReturn": false,
			"namedExportsAlwaysUseExplicitReturn": true,
			"usePrettier": false
		}]
	}
}
```

#### Options

- **`maxLen`** (default: `80`): Maximum line length before enforcing explicit
  returns
- **`jsxAlwaysUseExplicitReturn`** (default: `false`): Always use explicit
  returns for JSX elements
- **`namedExportsAlwaysUseExplicitReturn`** (default: `true`): Enforce explicit
  returns for named exports
- **`usePrettier`** (default: `false`): Use Prettier to determine actual
  formatted line length instead of raw code length

#### Prettier Integration

When `usePrettier` is enabled, the rule uses Prettier to format code before
measuring line length, providing more accurate decisions about when to use
explicit vs implicit returns.

**Setup:**

1. Install Prettier as a peer dependency: `npm install prettier --save-dev`
2. Configure Prettier in your project (`.prettierrc`, `prettier.config.js`,
   etc.)
3. Enable the option: `"usePrettier": true`

**Benefits:**

- More accurate line length calculations based on actual formatted output
- Consistent with your project's Prettier formatting rules
- Reduces conflicts between ESLint fixes and Prettier formatting

**Example:**

```js
// Without Prettier: This might be considered "long" due to spacing
const object = () => ({  prop1   :   "val",   prop2   :   "val2"  });

// With Prettier: Rule sees the formatted version and makes better decisions
const object2 = () => ({ prop1: "val", prop2: "val2" }); // ✅ Implicit return OK
```

### `no-export-default-arrow`

This rule has no configuration options and automatically generates function
names from filenames.

## Examples

### `arrow-return-style` Rule

#### ❌ Incorrect

```js
// Too long for implicit return
const longFunction = () => someVeryLongFunctionCall() + anotherLongCall() + moreCode();

// Named export should use explicit return
export const getUser = () => ({ name: "admin" });

// Comments between arrow and body
const commented = () => /* comment */ value;
```

#### ✅ Correct

```js
// Long expressions use explicit return
const longFunction = () => {
  return someVeryLongFunctionCall() + anotherLongCall() + moreCode();
};

// Named export with explicit return
export const getUser = () => {
  return { name: "admin" };
};

// Short expressions can use implicit return
const short = () => value;
```

### `no-export-default-arrow` Rule

#### ❌ Incorrect Usage

```js
// File: useCounter.ts
export default () => {
  const [count, setCount] = useState(0);
  return { count, setCount };
};
```

#### ✅ Correct (Auto-fixed)

```js
// File: useCounter.ts
const useCounter = () => {
  const [count, setCount] = useState(0);
  return { count, setCount };
};

export default useCounter;
```

## Rules Reference

<!-- begin auto-generated rules list -->

🔧 Automatically fixable by the
[`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).\
💭
Requires [type information](https://typescript-eslint.io/linting/typed-linting).

| Name                                                                          | Description                                                                                                          | 🔧  | 💭  |
| :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------- | :-- | :-- |
| [arrow-return-style](src/rules/arrow-return-style/documentation.md)           | Enforce consistent arrow function return style based on length, multiline expressions, JSX usage, and export context | 🔧  |     |
| [no-export-default-arrow](src/rules/no-export-default-arrow/documentation.md) | Disallow anonymous arrow functions as export default declarations                                                    | 🔧  | 💭  |

<!-- end auto-generated rules list -->

## Contributing

Contributions are welcome!

## License

[MIT](./LICENSE) License © 2024
[Christopher Buss](https://github.com/christopher-buss)

Original work © 2023 [u3u](https://github.com/u3u)

<!-- Badges -->

[npm-version-src]:
	https://img.shields.io/npm/v/eslint-plugin-arrow-return-style-x
[npm-version-href]: https://npmjs.com/package/eslint-plugin-arrow-return-style-x
[npm-downloads-src]:
	https://img.shields.io/npm/dm/eslint-plugin-arrow-return-style-x
[npm-downloads-href]:
	https://npmjs.com/package/eslint-plugin-arrow-return-style-x
[license-src]:
	https://img.shields.io/github/license/christopher-buss/eslint-plugin-arrow-return-style-x.svg
[license-href]: ./LICENSE
