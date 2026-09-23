import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import monkey from "vite-plugin-monkey";

const __dirname = dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(resolve(__dirname, "./package.json"), "utf8"));

/**
 * Unique userscript id for this package.
 *
 * Single source of truth — the release workflow reads this export to map a
 * `<id>-v<version>` tag to this package. Do NOT duplicate it in package.json.
 */
export const USERSCRIPT_ID = "h1dl";

/**
 * What this script is.
 *
 * `feature` is one capability. `aio` bundles several and conflicts with any
 * script that lists one of them. Declared here so the runtime claim, the
 * presence annotation and the metadata cannot drift apart.
 */
export const USERSCRIPT_KIND = "feature" as const;
export const USERSCRIPT_CAPABILITIES = ["hanime1:download"] as const;

/** Written only here and injected into the script. */
export const USERSCRIPT_NAME = "Hanime1 Download Manager";
export const USERSCRIPT_DESCRIPTION =
  "Replace download links with a native-style quality menu, batch download mode, and in-page downloads without leaving the page.";
export const USERSCRIPT_MATCH = [
  "*://hanime1.com/*",
  "*://hanime1.me/*",
  "*://hanimeone.com/*",
  "*://hanimeone.me/*",
];
export const USERSCRIPT_FILE = "hanime1-download-manager.user.js";

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
const PACKAGE_PATH = "packages/hanime1-download-manager";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/${PACKAGE_PATH}/dist`;

// Every translation lives in one file. Adding a language adds an entry, never
// a file. The script fetches this URL at runtime; the plugin copies the file
// next to the built script and serves it in dev.
const LOCALES_FILE = "locales.json";

function localesPlugin(): Plugin {
  const source = resolve(__dirname, LOCALES_FILE);
  return {
    name: "locales",
    configureServer(server) {
      server.middlewares.use(`/${LOCALES_FILE}`, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(readFileSync(source));
      });
    },
    // closeBundle, not buildStart: Vite empties outDir after buildStart,
    // which would delete a copy made any earlier.
    closeBundle() {
      const outDir = resolve(__dirname, "dist");
      mkdirSync(outDir, { recursive: true });
      cpSync(source, resolve(outDir, LOCALES_FILE));
    },
  };
}

export default defineConfig(({ command }) => ({
  define: {
    // Absolute: GM_xmlhttpRequest resolves a relative URL against the host
    // page, not the dev server, so `/locales.json` would miss.
    __LOCALE_URL__: JSON.stringify(
      command === "serve" ? `http://localhost:5173/${LOCALES_FILE}` : `${RAW_BASE}/${LOCALES_FILE}`,
    ),
    __SCRIPT_ID__: JSON.stringify(USERSCRIPT_ID),
    __SCRIPT_NAME__: JSON.stringify(USERSCRIPT_NAME),
    __SCRIPT_DESCRIPTION__: JSON.stringify(USERSCRIPT_DESCRIPTION),
    __SCRIPT_KIND__: JSON.stringify(USERSCRIPT_KIND),
    __SCRIPT_CAPABILITIES__: JSON.stringify(USERSCRIPT_CAPABILITIES),
  },
  plugins: [
    localesPlugin(),
    monkey({
      entry: "./src/main.ts",
      userscript: {
        name: USERSCRIPT_NAME,
        namespace: "Violentmonkey Scripts",
        version: VERSION,
        author: "OG-Open-Source",
        description: USERSCRIPT_DESCRIPTION,
        match: [
          ...USERSCRIPT_MATCH,
          // Also runs on the manager page, only to publish its presence.
          "https://og-open-source.github.io/UserScripts/",
          "https://og-open-source.github.io/UserScripts/*",
        ],
        connect: [
          "hanime1.com",
          "hanime1.me",
          "hanimeone.com",
          "hanimeone.me",
          "vdownload.hembed.com",
          // locales.json is fetched at runtime.
          "raw.githubusercontent.com",
          "localhost",
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
        downloadURL: `${RAW_BASE}/${USERSCRIPT_FILE}`,
        icon: "https://vdownload.hembed.com/image/icon/nav_logo.png?secure=HxkFdqiVxMMXXjau9riwGg==,4855471889",
      },
      build: {
        fileName: USERSCRIPT_FILE,
        metaFileName: true,
      },
      server: {
        open: true,
        prefix: "server:",
      },
    }),
  ],
}));
