import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type RGB = [number, number, number];

// Smooth, readable rainbow palette: red → orange → yellow → green → cyan → blue → violet → pink.
const RAINBOW: RGB[] = [
	[255, 92, 128],
	[255, 164, 88],
	[255, 222, 96],
	[106, 224, 126],
	[72, 214, 232],
	[104, 166, 255],
	[171, 130, 255],
	[255, 112, 219],
];

const RESET_FG = "\x1b[39m";
const ANSI_PATTERN = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate?: number;
}

interface CodexQuotaState {
	activeLimit?: string;
	planType?: string;
	creditsUnlimited?: boolean;
	primaryUsedPercent?: number;
	primaryWindowMinutes?: number;
	primaryResetAfterSeconds?: number;
	secondaryUsedPercent?: number;
	secondaryWindowMinutes?: number;
	secondaryResetAfterSeconds?: number;
	updatedAt: number;
}

let activeTui: TUI | undefined;
let latestCodexQuota: CodexQuotaState | undefined;

function clampChannel(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

function sampleRainbow(position: number): RGB {
	const scaled = positiveModulo(position, RAINBOW.length);
	const index = Math.floor(scaled);
	const nextIndex = (index + 1) % RAINBOW.length;
	const t = scaled - index;
	const from = RAINBOW[index]!;
	const to = RAINBOW[nextIndex]!;

	return [
		clampChannel(lerp(from[0], to[0], t)),
		clampChannel(lerp(from[1], to[1], t)),
		clampChannel(lerp(from[2], to[2], t)),
	];
}

function fg([r, g, b]: RGB, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}${RESET_FG}`;
}

function rainbowize(text: string, frame: number, offset = 0): string {
	let output = "";
	let column = 0;
	const phase = frame * 0.32;
	const plainText = stripAnsi(text);

	for (const char of [...plainText]) {
		const width = Math.max(1, visibleWidth(char));
		if (char === " ") {
			output += char;
		} else {
			output += fg(sampleRainbow(offset + column * 0.42 + phase), char);
		}
		column += width;
	}

	return output + RESET_FG;
}

function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatDuration(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds));
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) return `${days}d${hours}h`;
	if (hours > 0) return `${hours}h${minutes}m`;
	return `${minutes}m`;
}

function formatWindow(minutes: number | undefined, fallback: string): string {
	if (!minutes) return fallback;
	if (minutes % 1_440 === 0) return `${minutes / 1_440}d`;
	if (minutes % 60 === 0) return `${minutes / 60}h`;
	return `${minutes}m`;
}

function parseNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (/^true$/i.test(value)) return true;
	if (/^false$/i.test(value)) return false;
	return undefined;
}

function parseCodexQuotaHeaders(headers: Record<string, string>): CodexQuotaState | undefined {
	const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
	const hasCodexQuotaHeader = Object.keys(lowerHeaders).some((name) => name.startsWith("x-codex-"));
	if (!hasCodexQuotaHeader) return undefined;

	return {
		activeLimit: lowerHeaders["x-codex-active-limit"],
		planType: lowerHeaders["x-codex-plan-type"],
		creditsUnlimited: parseBoolean(lowerHeaders["x-codex-credits-unlimited"]),
		primaryUsedPercent: parseNumber(lowerHeaders["x-codex-primary-used-percent"]),
		primaryWindowMinutes: parseNumber(lowerHeaders["x-codex-primary-window-minutes"]),
		primaryResetAfterSeconds: parseNumber(lowerHeaders["x-codex-primary-reset-after-seconds"]),
		secondaryUsedPercent: parseNumber(lowerHeaders["x-codex-secondary-used-percent"]),
		secondaryWindowMinutes: parseNumber(lowerHeaders["x-codex-secondary-window-minutes"]),
		secondaryResetAfterSeconds: parseNumber(lowerHeaders["x-codex-secondary-reset-after-seconds"]),
		updatedAt: Date.now(),
	};
}

function formatCodexQuota(): string | undefined {
	if (!latestCodexQuota) return undefined;

	const primaryWindow = formatWindow(latestCodexQuota.primaryWindowMinutes, "5h");
	const secondaryWindow = formatWindow(latestCodexQuota.secondaryWindowMinutes, "1w");
	const primaryUsage = latestCodexQuota.primaryUsedPercent ?? "?";
	const secondaryUsage = latestCodexQuota.secondaryUsedPercent ?? "?";
	const primaryReset =
		latestCodexQuota.primaryResetAfterSeconds === undefined
			? "?"
			: formatDuration(latestCodexQuota.primaryResetAfterSeconds);
	const secondaryReset =
		latestCodexQuota.secondaryResetAfterSeconds === undefined
			? "?"
			: formatDuration(latestCodexQuota.secondaryResetAfterSeconds);

	return `GPT ${primaryWindow} ${primaryUsage}% ↻ ${primaryReset} · ${secondaryWindow} ${secondaryUsage}% ↻ ${secondaryReset}`;
}

function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};

	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;

		const usage = (entry.message as AssistantMessage).usage;
		if (!usage) continue;

		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost.total;

		const latestPromptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
		totals.latestCacheHitRate = latestPromptTokens > 0 ? (usage.cacheRead / latestPromptTokens) * 100 : undefined;
	}

	return totals;
}

function getContextPart(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;

	if (!usage || usage.percent === null) {
		return contextWindow > 0 ? `?/${formatTokens(contextWindow)}` : "?";
	}

	return `${usage.percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
}

function buildLocationLine(ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider): string {
	let location = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
	const branch = footerData.getGitBranch();
	const sessionName = ctx.sessionManager.getSessionName();

	if (branch) location = `${location} (${branch})`;
	if (sessionName) location = `${location} • ${sessionName}`;

	return location;
}

function buildStatsParts(ctx: ExtensionContext): string[] {
	const totals = getUsageTotals(ctx);
	const parts: string[] = [];

	if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead > 0 || totals.cacheWrite > 0) && totals.latestCacheHitRate !== undefined) {
		parts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
	}

	const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
	if (totals.cost || usingSubscription) {
		parts.push(`$${totals.cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
	}

	parts.push(getContextPart(ctx));
	return parts;
}

function buildRightSide(pi: ExtensionAPI, ctx: ExtensionContext, footerData: ReadonlyFooterDataProvider, leftWidth: number, width: number): string {
	const modelName = ctx.model?.id || "no-model";
	let rightSide = modelName;

	if (ctx.model?.reasoning) {
		const thinkingLevel = pi.getThinkingLevel();
		rightSide = thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
	}

	if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
		const withProvider = `(${ctx.model.provider}) ${rightSide}`;
		if (leftWidth + 2 + visibleWidth(withProvider) <= width) {
			rightSide = withProvider;
		}
	}

	return rightSide;
}

function fitFooterLine(text: string, width: number): string {
	return truncateToWidth(text, width, "...");
}

function buildPrimaryLine(location: string, statsLeft: string, rightSide: string, width: number): string {
	const statsSuffix = statsLeft ? ` ${statsLeft}` : "";
	const rightSuffix = rightSide ? `  ${rightSide}` : "";
	const availableForLocation = width - visibleWidth(statsSuffix) - visibleWidth(rightSuffix);

	if (availableForLocation > 0) {
		const fittedLocation = truncateToWidth(location, availableForLocation, "...");
		const line = `${fittedLocation}${statsSuffix}${rightSuffix}`;
		return fitFooterLine(line, width);
	}

	return fitFooterLine(`${location}${statsSuffix}${rightSuffix}`, width);
}

class RainbowFooter implements Component {
	private frame = 0;
	private readonly interval: ReturnType<typeof setInterval>;
	private readonly unsubscribeBranch: () => void;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly ctx: ExtensionContext,
		private readonly tui: TUI,
		private readonly footerData: ReadonlyFooterDataProvider,
	) {
		activeTui = tui;
		this.unsubscribeBranch = footerData.onBranchChange(() => this.tui.requestRender());
		this.interval = setInterval(() => {
			this.frame = (this.frame + 1) % 10_000;
			this.tui.requestRender();
		}, 180);
	}

	render(width: number): string[] {
		if (width <= 0) return [];

		const location = buildLocationLine(this.ctx, this.footerData);
		const statsLeft = buildStatsParts(this.ctx).join(" ");
		const firstLineLeft = statsLeft ? `${location} ${statsLeft}` : location;
		const rightSide = buildRightSide(this.pi, this.ctx, this.footerData, visibleWidth(firstLineLeft), width);
		const primaryLine = buildPrimaryLine(location, statsLeft, rightSide, width);
		const quotaLine = fitFooterLine(formatCodexQuota() ?? "....", width);

		return [rainbowize(primaryLine, this.frame), rainbowize(quotaLine, this.frame, 1.5)];
	}

	invalidate(): void {
		// Colors are computed during render, so a theme invalidation only needs a rerender.
	}

	dispose(): void {
		clearInterval(this.interval);
		this.unsubscribeBranch();
		if (activeTui === this.tui) activeTui = undefined;
	}
}

export default function rainbowFooterExtension(pi: ExtensionAPI) {
	pi.on("after_provider_response", (event) => {
		const quota = parseCodexQuotaHeaders(event.headers);
		if (!quota) return;

		latestCodexQuota = quota;
		activeTui?.requestRender();
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, _theme, footerData) => new RainbowFooter(pi, ctx, tui, footerData));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
