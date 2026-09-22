import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(
	readFileSync(resolve(__dirname, "./package.json"), "utf8"),
);

/**
 * Unique userscript id for this package.
 *
 * Single source of truth — the release workflow reads this export to map a
 * `<id>-v<version>` tag to this package. Do NOT duplicate it in package.json.
 */
export const USERSCRIPT_ID = "h1dl";

/**
 * Version — the tag is the source of truth.
 *
 * The release workflow sets USERSCRIPT_VERSION from the pushed tag
 * (`h1dl-v1.1.0` → `1.1.0`), so a release never touches package.json.
 * Local builds (no tag, no version in package.json) fall back to a
 * `0.0.0-dev` placeholder so `bun run dev` still emits a valid `@version`.
 */
const VERSION = process.env.USERSCRIPT_VERSION ?? pkg.version ?? "0.0.0-dev";

// Base raw URL for released assets. The release workflow publishes
// dist/*.user.js to this path, and the userscript update URLs point here so
// installed scripts can self-update via @updateURL.
const REPO = "OG-Open-Source/UserScripts";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/packages/hanime1-download-manager/dist`;

export default defineConfig({
	plugins: [
		monkey({
			entry: "./src/main.ts",
			userscript: {
				name: "Hanime1 Download Manager",
				namespace: "Violentmonkey Scripts",
				version: VERSION,
				author: "https://github.com/OG-Open-Source/UserScripts",
				description:
					"Replace download links with a native-style quality menu, batch download mode, and in-page downloads without leaving the page. Languages: 繁體中文 / 简体中文 / English.",
				match: [
					"*://hanime1.com/*",
					"*://hanime1.me/*",
					"*://hanimeone.com/*",
					"*://hanimeone.me/*",
				],
				connect: [
					"hanime1.com",
					"hanime1.me",
					"hanimeone.com",
					"hanimeone.me",
					"vdownload.hembed.com",
				],
				grant: [
					"GM_xmlhttpRequest",
					"GM_download",
					"GM_setValue",
					"GM_getValue",
					"GM_registerMenuCommand",
				],
				"run-at": "document-idle",
				// meta.js is a small comment-only file; @updateURL points at it so
				// update checks only download that instead of the whole script.
				updateURL: `${RAW_BASE}/hanime1-download-manager.meta.js`,
				downloadURL: `${RAW_BASE}/hanime1-download-manager.user.js`,
				icon: "https://vdownload.hembed.com/image/icon/nav_logo.png?secure=HxkFdqiVxMMXXjau9riwGg==,4855471889",
			},
			build: {
				fileName: "hanime1-download-manager.user.js",
				metaFileName: true,
			},
			server: {
				open: true,
				prefix: "server:",
			},
		}),
	],
});
