import isentinel, { GLOB_MARKDOWN_CODE } from "@isentinel/eslint-config";

export default isentinel(
	{
		eslintPlugin: true,
		pnpm: true,
		roblox: false,
		rules: {
			"max-lines": "off",
		},
		test: false,
		type: "package",
	},
	{
		ignores: ["fixtures", "PRETTIER_*.md"],
	},
	{
		files: [GLOB_MARKDOWN_CODE],
		rules: {
			"arrow-style/arrow-return-style": "off",
			"arrow-style/no-export-default-arrow": "off",
			"func-style": "off",
		},
	},
);
