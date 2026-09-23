/**
 * Scaffold a new userscript package.
 *
 * Usage: bun run new-script <name> [--framework vanilla|solid|svelte]
 *
 * Creates packages/<name>/ with a vite-plugin-monkey project wired to
 * @userscripts/shared. Vanilla TS is the default — reach for SolidJS or
 * Svelte only when the script needs a full reactive UI (see
 * docs/monorepo-architecture.md).
 *
 * Single source of truth: vite.config.ts exports USERSCRIPT_ID and reads the
 * version from the USERSCRIPT_VERSION env var (set by the release workflow
 * from the pushed tag). package.json carries no version or id — releasing is
 * just `git tag <id>-v<version>`.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { exit } from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const AUTHOR = "https://github.com/OG-Open-Source/UserScripts";
const REPO = "OG-Open-Source/UserScripts";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run new-script <name> [--framework vanilla|solid|svelte]");
  exit(1);
}

const name = args[0];
const frameworkIdx = args.indexOf("--framework");
const framework = frameworkIdx !== -1 ? args[frameworkIdx + 1] : "vanilla";
if (!["vanilla", "solid", "svelte"].includes(framework)) {
  console.error(`Unknown framework: ${framework}. Use vanilla | solid | svelte.`);
  exit(1);
}

// Unique userscript id: lowercase, digits and hyphens only. Used in release
// tags (<id>-v<version>), so it must match the workflow's [a-z0-9]+-v* filter.
const id = name.toLowerCase().replace(/[^a-z0-9-]/g, "");

const pkgDir = resolve(root, "packages", name);
if (existsSync(pkgDir)) {
  console.error(`packages/${name} already exists.`);
  exit(1);
}
mkdirSync(resolve(pkgDir, "src"), { recursive: true });

const packageName = `@userscripts/${name}`;
const titleName = name
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

// No version field: the tag is the source of truth. No userscript.id field:
// vite.config.ts's USERSCRIPT_ID export is the single source the release
// workflow reads.
writeFileSync(
  resolve(pkgDir, "package.json"),
  JSON.stringify(
    {
      name: packageName,
      private: true,
      description: `${titleName} userscript.`,
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@userscripts/shared": "*",
        ...(framework === "solid"
          ? { "solid-js": "^1.9.0" }
          : framework === "svelte"
            ? { svelte: "^5.0.0" }
            : {}),
      },
      devDependencies: {
        typescript: "^5.9.0",
        vite: "^7.1.0",
        "vite-plugin-monkey": "^5.0.0",
        "@types/node": "^22.0.0",
        ...(framework === "solid"
          ? { "vite-plugin-solid": "^2.11.0" }
          : framework === "svelte"
            ? { "@sveltejs/vite-plugin-svelte": "^5.0.0" }
            : {}),
      },
    },
    null,
    2,
  ) + "\n",
);

const entry =
  framework === "svelte" ? "src/main.ts" : framework === "solid" ? "src/main.tsx" : "src/main.ts";

writeFileSync(
  resolve(pkgDir, "vite.config.ts"),
  `import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';${
    framework === "solid"
      ? "\nimport solid from 'vite-plugin-solid';"
      : framework === "svelte"
        ? "\nimport { svelte } from '@sveltejs/vite-plugin-svelte';"
        : ""
  }
import monkey from 'vite-plugin-monkey';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, './package.json'), 'utf8'));

/**
 * Unique userscript id for this package.
 *
 * Single source of truth — the release workflow reads this export to map a
 * \`<id>-v<version>\` tag to this package. Do NOT duplicate it in package.json.
 */
export const USERSCRIPT_ID = '${id}';

/**
 * Injected into the script and published as a DOM annotation, which is how the
 * settings pages learn the script exists. Do not keep a second copy.
 */
export const USERSCRIPT_NAME = '${titleName}';
export const USERSCRIPT_DESCRIPTION = '${titleName} userscript.';
export const USERSCRIPT_MATCH = ['*://example.com/*'];
export const USERSCRIPT_FILE = '${name}.user.js';

/**
 * Version — the tag is the source of truth.
 *
 * The release workflow sets USERSCRIPT_VERSION from the pushed tag
 * (\`${id}-v1.0.0\` → \`1.0.0\`), so a release never touches package.json.
 * Local builds (no tag, no version in package.json) fall back to a
 * \`0.0.0-dev\` placeholder so \`bun run dev\` still emits a valid @version.
 */
const VERSION =
  process.env.USERSCRIPT_VERSION ?? pkg.version ?? "0.0.0-dev";

// Released assets are published by the release workflow; the update URLs
// point here so installed scripts self-update via @updateURL.
const RAW_BASE = \`https://raw.githubusercontent.com/${REPO}/main/packages/${name}/dist\`;

export default defineConfig({
  plugins: [
    ${framework === "solid" ? "solid(),\n    " : ""}${
      framework === "svelte" ? "svelte(),\n    " : ""
    }monkey({
      entry: './${entry}',
      userscript: {
        name: USERSCRIPT_NAME,
        namespace: 'Violentmonkey Scripts',
        version: VERSION,
        author: '${AUTHOR}',
        description: USERSCRIPT_DESCRIPTION,
        match: [...USERSCRIPT_MATCH],
        grant: [],
        updateURL: \`\${RAW_BASE}/${name}.meta.js\`,
        downloadURL: \`\${RAW_BASE}/\${USERSCRIPT_FILE}\`,
      },
      build: {
        fileName: USERSCRIPT_FILE,
        metaFileName: true,
      },
      server: {
        open: true,
        prefix: 'server:',
      },
    }),
  ],
});
`,
);

writeFileSync(
  resolve(pkgDir, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        noEmit: true,
        types: ["node", "vite-plugin-monkey/client"],
      },
      include: ["src/**/*.ts", "vite.config.ts", "vite-env.d.ts"],
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  resolve(pkgDir, "vite-env.d.ts"),
  '/// <reference types="vite-plugin-monkey/client" />\n',
);

if (framework === "vanilla") {
  writeFileSync(
    resolve(pkgDir, "src/main.ts"),
    `/**
 * ${titleName} — userscript entry.
 *
 * Scaffolded with the Vanilla TS template. Import shared utilities from
 * '@userscripts/shared' and GM APIs from the '$' client alias.
 */
import { configureGmApi } from '@userscripts/shared';

configureGmApi({});

console.log('[${id}] loaded');
`,
  );
} else if (framework === "solid") {
  writeFileSync(
    resolve(pkgDir, "src/main.tsx"),
    `/**
 * ${titleName} — userscript entry (SolidJS).
 *
 * Mount a reactive UI into the page; keep DOM-surgery concerns in plain
 * modules so they stay testable outside the component tree.
 */
import { render } from 'solid-js/web';
import { configureGmApi } from '@userscripts/shared';

configureGmApi({});

const host = document.createElement('div');
host.id = '${id}-root';
document.documentElement.appendChild(host);

render(() => <div>${titleName}</div>, host);
`,
  );
} else {
  writeFileSync(
    resolve(pkgDir, "src/main.ts"),
    `/**
 * ${titleName} — userscript entry (Svelte).
 */
import { mount } from 'svelte';
import { configureGmApi } from '@userscripts/shared';
import App from './App.svelte';

configureGmApi({});

const host = document.createElement('div');
host.id = '${id}-root';
document.documentElement.appendChild(host);

mount(App, { target: host });
`,
  );
  writeFileSync(
    resolve(pkgDir, "src/App.svelte"),
    `<script lang="ts">
  // ${titleName} root component.
</script>

<div>${titleName}</div>
`,
  );
}

console.log(`Created packages/${name} (${framework}), USERSCRIPT_ID='${id}'.`);
console.log(`Release with: git tag ${id}-v1.0.0 && git push --tags`);
