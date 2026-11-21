import { type EncodedInlineSegment, encodeInlineNodes } from "../capture/inline-codec";
import type { TranslationSegment } from "../capture/segmenter";
import { type OpenCCMode, resolveSpacingMode, type TranslatorConfig } from "../config";
import { type PtrMetrics, recordApiBatch } from "../metrics";
import { type InspectKind, renderError, renderInspectMarker, renderPending, renderTranslated } from "../renderer";
import type { CompiledSiteDelta } from "../site-rules";
import { extractPageKeywords, maskKeywordsInHtml } from "../transform/keywords";
import { routeSegment } from "../transform/lang-route";
import type { OpenCCConverter } from "../transform/opencc";
import { extractTemplate, matchSiteTranslation, type SiteLocaleTable } from "../transform/template";
import type { TranslationProvider } from "./provider";

export interface BatchRunnerOptions {
	doc: Document;
	delta: CompiledSiteDelta;
	getConfig: () => TranslatorConfig;
	getProvider: (cfg: TranslatorConfig) => TranslationProvider;
	getOpenCC?: (mode: Exclude<OpenCCMode, "off">) => Promise<OpenCCConverter>;
	getGlossary?: () => readonly string[];
	getSiteLocaleTable?: () => SiteLocaleTable | null;
	metrics?: PtrMetrics;
}

export function createBatchRunner(options: BatchRunnerOptions) {
	let generation = 0;
	const pageCache = new Map<string, string>();

	async function translateBatch(segments: TranslationSegment[]): Promise<void> {
		if (segments.length === 0) return;
		const gen = generation;
		const cfg = options.getConfig();
		const metrics = options.metrics;
		const spacingMode = resolveSpacingMode(cfg);
		const siteTable = options.getSiteLocaleTable?.() ?? null;
		const provider = options.getProvider(cfg);

		if (cfg.debugInspect && cfg.provider === "inspect") {
			for (const seg of segments) {
				const enc = encodeInlineNodes(seg.nodes, options.delta);
				const kind: InspectKind =
					seg.sourceRule === "+"
						? "+"
						: siteTable && matchSiteTranslation(enc.payloadHtml, siteTable)
							? "manual"
							: extractTemplate(enc.payloadHtml).kind === "dynamic"
								? "auto-dynamic"
								: "auto-static";
				renderInspectMarker(seg, options.doc, { kind, spacingMode });
			}
			return;
		}

		const openccJobs: Array<{
			seg: TranslationSegment;
			encoded: EncodedInlineSegment;
			mode: Exclude<OpenCCMode, "off">;
		}> = [];
		const apiJobs: Array<{
			seg: TranslationSegment;
			encoded: EncodedInlineSegment;
			maskedPayload: string;
			cacheKey: string;
		}> = [];
		const immediateHits: Array<{
			seg: TranslationSegment;
			encoded: EncodedInlineSegment;
			html: string;
			needsOpenCC: boolean;
		}> = [];

		const plainTexts = segments.map((s) =>
			s.nodes
				.map((n) => n.textContent ?? "")
				.join("")
				.trim(),
		);
		const pageKeywords = extractPageKeywords(plainTexts);
		const keywords = [...(options.getGlossary?.() ?? []), ...pageKeywords];
		if (metrics) metrics.keywordsSample = [...keywords];

		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i]!;
			const plain = plainTexts[i]!;
			const encoded = encodeInlineNodes(seg.nodes, options.delta);
			const manualHit = matchSiteTranslation(encoded.payloadHtml, siteTable, seg.container);

			if (cfg.debugInspect) {
				const kind: InspectKind =
					seg.sourceRule === "+"
						? "+"
						: manualHit
							? "manual"
							: extractTemplate(encoded.payloadHtml).kind === "dynamic"
								? "auto-dynamic"
								: "auto-static";
				renderInspectMarker(seg, options.doc, { kind, spacingMode });
			}

			// Route purely by the segment's own text; page-level <html lang> or
			// ancestor [lang] attributes are intentionally ignored here.
			const route = routeSegment(plain, cfg.targetLang);

			if (metrics) {
				if (route.action === "skip") metrics.routing.skip += 1;
				else if (route.action === "opencc") metrics.routing.opencc += 1;
				else metrics.routing.api += 1;
			}

			if (route.action === "skip") {
				continue;
			}

			if (route.action === "opencc") {
				openccJobs.push({ seg, encoded, mode: route.mode });
				continue;
			}

			if (manualHit) {
				if (metrics) {
					metrics.segments.manual += 1;
					if (manualHit.scope) metrics.segments.scopedHits += 1;
				}
				immediateHits.push({ seg, encoded, html: manualHit.html, needsOpenCC: false });
				continue;
			}

			const maskedPayload =
				provider.id === "inspect" ? encoded.payloadHtml : maskKeywordsInHtml(encoded.payloadHtml, keywords);
			const cacheKey = `${cfg.targetLang}|${provider.id}|${maskedPayload}`;
			const cached = pageCache.get(cacheKey);
			if (cached !== undefined) {
				if (metrics) metrics.cacheHits += 1;
				immediateHits.push({ seg, encoded, html: cached, needsOpenCC: cfg.openccMode !== "off" });
				continue;
			}

			apiJobs.push({ seg, encoded, maskedPayload, cacheKey });
			if (metrics) metrics.cacheMisses += 1;
		}

		const postBase = { spacingMode, punctNorm: cfg.punctNorm, debugSpacingMarks: cfg.debugSpacingMarks };

		const needsImmediateOpenCC =
			cfg.openccMode !== "off" && Boolean(options.getOpenCC) && immediateHits.some((h) => h.needsOpenCC);
		const immediateConv = needsImmediateOpenCC
			? await options.getOpenCC!(cfg.openccMode as Exclude<OpenCCMode, "off">)
			: undefined;
		if (gen !== generation) return;

		for (const hit of immediateHits) {
			renderPending(hit.seg, options.doc);
			renderTranslated(
				hit.seg,
				hit.html,
				hit.encoded.slots,
				{
					...postBase,
					...(hit.needsOpenCC && immediateConv ? { opencc: (s: string) => immediateConv.convert(s) } : {}),
				},
				options.doc,
			);
		}

		if (openccJobs.length > 0 && options.getOpenCC) {
			const modes = Array.from(new Set(openccJobs.map((j) => j.mode)));
			const convMap = new Map<Exclude<OpenCCMode, "off">, OpenCCConverter>();
			const openccInitStart = Date.now();
			await Promise.all(
				modes.map(async (m) => {
					convMap.set(m, await options.getOpenCC!(m));
				}),
			);
			if (metrics) metrics.openccInitMs = Date.now() - openccInitStart;
			if (gen !== generation) return;
			for (const job of openccJobs) {
				const conv = convMap.get(job.mode);
				renderPending(job.seg, options.doc);
				renderTranslated(
					job.seg,
					job.encoded.payloadHtml,
					job.encoded.slots,
					{ ...postBase, opencc: conv ? (s) => conv.convert(s) : undefined },
					options.doc,
				);
			}
		}

		if (apiJobs.length === 0) return;

		for (const job of apiJobs) {
			renderPending(job.seg, options.doc);
		}

		const uniquePayloads: string[] = [];
		const payloadToIdx = new Map<string, number>();
		for (const job of apiJobs) {
			if (!payloadToIdx.has(job.maskedPayload)) {
				payloadToIdx.set(job.maskedPayload, uniquePayloads.length);
				uniquePayloads.push(job.maskedPayload);
			}
		}
		if (metrics) {
			metrics.apiTotalJobs += apiJobs.length;
			metrics.apiUniquePayloads += uniquePayloads.length;
		}

		const openccPromise = cfg.openccMode !== "off" && options.getOpenCC ? options.getOpenCC(cfg.openccMode) : undefined;

		try {
			const apiStart = Date.now();
			const [results, opencc] = await Promise.all([
				provider.translateBatch(uniquePayloads, { targetLang: cfg.targetLang }),
				openccPromise,
			]);
			if (metrics) recordApiBatch(metrics, Date.now() - apiStart);

			if (gen !== generation) return;

			for (const job of apiJobs) {
				const uIdx = payloadToIdx.get(job.maskedPayload)!;
				const translated = results[uIdx] ?? job.encoded.payloadHtml;
				pageCache.set(job.cacheKey, translated);
				renderTranslated(
					job.seg,
					translated,
					job.encoded.slots,
					{ ...postBase, opencc: opencc ? (s) => opencc.convert(s) : undefined },
					options.doc,
				);
			}
		} catch (err) {
			if (gen !== generation) return;
			console.error("[ptr] translation failed:", err);
			for (const job of apiJobs) {
				renderError(job.seg, options.doc);
			}
		}
	}

	return {
		translateBatch,
		cancelAll() {
			generation++;
		},
		clearCache() {
			pageCache.clear();
		},
	};
}
