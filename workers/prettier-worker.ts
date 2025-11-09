import type { Options as PrettierOptions } from "prettier";
import { runAsWorker } from "synckit";

interface ConfigResult {
	config: Record<string, any>;
	success: true;
}

interface ErrorResult {
	error: string;
	success: false;
}

interface FormatRequest {
	code: string;
	configOverride?: PrettierOptions;
	filePath?: string;
	type: "format";
}

interface FormatResult {
	/** Enhanced metrics. */
	allLineLengths: Array<number>;
	avgLineLength: number;
	formatted: string;
	hasComments: boolean;
	isMultiline: boolean;
	lineLength: number;
	maxLineLength: number;
	parser?: string;
	success: true;
	totalLines: number;
}

interface ResolveConfigRequest {
	filePath?: string;
	type: "resolveConfig";
}

type WorkerRequest = FormatRequest | ResolveConfigRequest;

type WorkerResult = ConfigResult | ErrorResult | FormatResult;

let prettier: typeof import("prettier") | undefined;
let prettierLoadAttempted = false;

const DEFAULT_FILE_PATH = "package.json";
const PRETTIER_NOT_LOADED_ERROR = "Prettier not loaded";

/**
 * Calculates comprehensive line metrics from formatted code lines.
 *
 * @param lines - Array of code lines.
 * @returns Metrics object with line length statistics.
 */
function calculateLineMetrics(lines: Array<string>): {
	allLineLengths: Array<number>;
	avgLineLength: number;
	maxLineLength: number;
	totalLines: number;
} {
	const allLineLengths = lines.map((line: string) => line.length);
	const maxLineLength = Math.max(...allLineLengths, 0);
	const avgLineLength =
		allLineLengths.length > 0
			? allLineLengths.reduce((sum: number, length: number) => sum + length, 0) /
				allLineLengths.length
			: 0;

	return {
		allLineLengths,
		avgLineLength,
		maxLineLength,
		totalLines: lines.length,
	};
}

/**
 * Detects if code contains comments.
 *
 * @param code - The code to check.
 * @returns True if comments are detected.
 */
function detectComments(code: string): boolean {
	return /\/\/|\/\*|\*\/|<!--/.test(code);
}

/**
 * Handles format request type.
 *
 * @param request - The format request to process.
 * @returns Promise resolving to format result.
 */
async function handleFormatRequest(request: FormatRequest): Promise<FormatResult> {
	if (!prettier) {
		throw new Error(PRETTIER_NOT_LOADED_ERROR);
	}

	const config = await resolveConfig(request.filePath, request.configOverride);

	const formatted = await prettier.format(request.code, {
		...config,
		filepath: request.filePath,
	});

	const trimmedFormatted = formatted.trim();
	const lines = trimmedFormatted.split("\n");
	const metrics = calculateLineMetrics(lines);

	return {
		...metrics,
		formatted: trimmedFormatted,
		hasComments: detectComments(trimmedFormatted),
		isMultiline: lines.length > 1,
		lineLength: lines[0]?.length ?? 0,
		parser: config?.parser as string | undefined,
		success: true,
	};
}

/**
 * Handles resolveConfig request type.
 *
 * @param request - The resolve config request to process.
 * @returns Promise resolving to config result.
 */
async function handleResolveConfigRequest(request: ResolveConfigRequest): Promise<ConfigResult> {
	if (!prettier) {
		throw new Error(PRETTIER_NOT_LOADED_ERROR);
	}

	const config = await prettier.resolveConfig(request.filePath ?? "package.json", {
		editorconfig: true,
	});

	return {
		config: config ?? {},
		success: true,
	};
}

/**
 * Loads prettier module dynamically.
 *
 * @returns Promise resolving to boolean indicating if prettier was loaded
 *   successfully.
 */
async function loadPrettier(): Promise<boolean> {
	if (prettierLoadAttempted) {
		return prettier !== undefined;
	}

	prettierLoadAttempted = true;

	try {
		prettier = await import("prettier");
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolves and merges prettier configuration.
 *
 * @param filePath - Optional file path for config resolution.
 * @param configOverride - Optional config overrides.
 * @returns Promise resolving to merged config.
 */
async function resolveConfig(
	filePath: string | undefined,
	configOverride: PrettierOptions | undefined,
): Promise<null | PrettierOptions> {
	if (!prettier) {
		throw new Error(PRETTIER_NOT_LOADED_ERROR);
	}

	const config = await prettier.resolveConfig(filePath ?? DEFAULT_FILE_PATH, {
		editorconfig: true,
	});

	return configOverride ? { ...config, ...configOverride } : config;
}

runAsWorker(async (request: WorkerRequest): Promise<WorkerResult> => {
	try {
		const loaded = await loadPrettier();
		if (!loaded || !prettier) {
			return {
				error: "Prettier not available",
				success: false,
			};
		}

		if (request.type === "format") {
			return await handleFormatRequest(request);
		}

		return await handleResolveConfigRequest(request);
	} catch (err) {
		return {
			error: err instanceof Error ? err.message : "Prettier operation failed",
			success: false,
		};
	}
});
