import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import monkey from "vite-plugin-monkey";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "./package.json"), "utf8")
);

/**
 * Unique userscript id for this package.
 *
 * Single source of truth — the release workflow reads this export to map a
 * `<id>-v<version>` tag to this package. Do NOT duplicate it in package.json.
 */
export const USERSCRIPT_ID = "ptr";

/** Written only here and injected into the script. */
export const USERSCRIPT_NAME = "Page Translator";
export const USERSCRIPT_DESCRIPTION =
  "Tag-free automatic web page translator with custom CSS presentation, CJK spacing, and Traditional/Simplified conversion.";
export const USERSCRIPT_MATCH = ["*://*/*"];
export const USERSCRIPT_FILE = "page-translator.user.js";

const VERSION = process.env.USERSCRIPT_VERSION ?? pkg.version ?? "0.0.0-dev";
const IS_RELEASE = VERSION !== "0.0.0-dev";
const OUT_DIR = IS_RELEASE ? "dist" : ".dist-dev";

const REPO = "OG-Open-Source/UserScripts";
const PACKAGE_PATH = "packages/page-translator";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/${PACKAGE_PATH}/dist`;

const LOCALES_FILE = "locales.json";
const DELTAS_FILE = "deltas.json";
const DELTAS_MAIN_URL = `https://raw.githubusercontent.com/${REPO}/main/${PACKAGE_PATH}/${DELTAS_FILE}`;
const TRANSLATIONS_DIR = "translations";
const TRANSLATIONS_MAIN_URL = `https://raw.githubusercontent.com/${REPO}/main/${PACKAGE_PATH}/${TRANSLATIONS_DIR}`;
const FINGERPRINTS_DIR = "fingerprints";
const FINGERPRINTS_MAIN_URL = `https://raw.githubusercontent.com/${REPO}/main/${PACKAGE_PATH}/${FINGERPRINTS_DIR}`;
const LEADING_SLASHES_RE = /^\/+/u;
const DOT_DOT_RE = /\.\./gu;

function copyJsonTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const sPath = resolve(src, entry.name);
    const dPath = resolve(dst, entry.name);
    if (entry.isDirectory()) {
      copyJsonTree(sPath, dPath);
    } else if (entry.name.endsWith(".json")) {
      cpSync(sPath, dPath);
    }
  }
}

function staticAssetsPlugin(): Plugin {
  const files = [LOCALES_FILE, DELTAS_FILE].map((name) => ({
    name,
    source: resolve(__dirname, name),
  }));
  const trDir = resolve(__dirname, TRANSLATIONS_DIR);
  const fpDir = resolve(__dirname, FINGERPRINTS_DIR);
  const jsonDirs = [
    { prefix: TRANSLATIONS_DIR, dir: trDir },
    { prefix: FINGERPRINTS_DIR, dir: fpDir },
  ];
  return {
    name: "static-assets",
    configureServer(server) {
      for (const f of files) {
        server.middlewares.use(`/${f.name}`, (_req, res) => {
          res.setHeader("content-type", "application/json");
          res.end(readFileSync(f.source));
        });
      }
      for (const { prefix, dir } of jsonDirs) {
        server.middlewares.use(`/${prefix}/`, (req, res, next) => {
          const rel = (req.url ?? "")
            .replace(LEADING_SLASHES_RE, "")
            .replace(DOT_DOT_RE, "");
          const target = resolve(dir, rel);
          if (rel && existsSync(target)) {
            res.setHeader("content-type", "application/json");
            res.end(readFileSync(target));
            return;
          }
          next();
        });
      }
    },
    closeBundle() {
      const outDir = resolve(__dirname, OUT_DIR);
      mkdirSync(outDir, { recursive: true });
      for (const f of files) {
        cpSync(f.source, resolve(outDir, f.name));
      }
      for (const { prefix, dir } of jsonDirs) {
        if (existsSync(dir)) {
          copyJsonTree(dir, resolve(outDir, prefix));
        }
      }
    },
  };
}

export default defineConfig(({ command }) => ({
  build: { outDir: OUT_DIR, emptyOutDir: true },
  define: {
    __LOCALE_URL__: JSON.stringify(
      command === "serve"
        ? `http://localhost:5173/${LOCALES_FILE}`
        : `${RAW_BASE}/${LOCALES_FILE}`
    ),
    __DELTAS_URL__: JSON.stringify(
      command === "serve"
        ? `http://localhost:5173/${DELTAS_FILE}`
        : DELTAS_MAIN_URL
    ),
    __TRANSLATIONS_BASE__: JSON.stringify(
      command === "serve"
        ? `http://localhost:5173/${TRANSLATIONS_DIR}`
        : TRANSLATIONS_MAIN_URL
    ),
    __FINGERPRINTS_BASE__: JSON.stringify(
      command === "serve"
        ? `http://localhost:5173/${FINGERPRINTS_DIR}`
        : FINGERPRINTS_MAIN_URL
    ),
    __SCRIPT_ID__: JSON.stringify(USERSCRIPT_ID),
    __SCRIPT_NAME__: JSON.stringify(USERSCRIPT_NAME),
    __SCRIPT_DESCRIPTION__: JSON.stringify(USERSCRIPT_DESCRIPTION),
  },
  plugins: [
    staticAssetsPlugin(),
    monkey({
      entry: "./src/main.ts",
      userscript: {
        name: USERSCRIPT_NAME,
        namespace: "Violentmonkey Scripts",
        version: VERSION,
        author: "OG-Open-Source",
        description: USERSCRIPT_DESCRIPTION,
        match: [...USERSCRIPT_MATCH],
        noframes: true,
        connect: [
          "translate-pa.googleapis.com",
          "raw.githubusercontent.com",
          "cdn.jsdelivr.net",
          "localhost",
        ],
        grant: [
          "GM_addStyle",
          "GM_xmlhttpRequest",
          "GM_getValue",
          "GM_setValue",
          "GM_registerMenuCommand",
          "GM_unregisterMenuCommand",
        ],
        "run-at": "document-idle",
        updateURL: `${RAW_BASE}/page-translator.meta.js`,
        downloadURL: `${RAW_BASE}/${USERSCRIPT_FILE}`,
      },
      build: { fileName: USERSCRIPT_FILE, metaFileName: true },
      server: { open: true, prefix: "server:" },
    }),
  ],
}));
