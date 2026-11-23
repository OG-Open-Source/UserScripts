import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSimpleCssThemeVarsCss } from "../packages/shared/src/index.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = resolve(ROOT, "settings/shared/tokens.css");
const css = `${getSimpleCssThemeVarsCss()}\n`;

writeFileSync(TARGET, css, "utf8");
console.log(`Synced ${TARGET} (${css.split("\n").length - 1} lines)`);
