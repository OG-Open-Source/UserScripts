/**
 * Native theme probing — read colors off the site's own CSS so injected UI
 * never hardcodes colors and stays in sync with the site's theme.
 *
 * Reading `.offsetLeft` forces a synchronous reflow, so `getComputedStyle`
 * returns the site's real styles instead of hidden-state defaults.
 */

export interface NativeTheme {
	panelBg: string;
	panelColor: string;
	itemHover: string;
	actionBg: string;
}

interface ProbeOptions {
	/** Site class to probe for panel colors (e.g. "more-horiz-panel"). */
	panelClass: string;
	/** Site class to probe for the action button background. */
	actionClass?: string;
	/** Hover background value used for menu items. */
	itemHover?: string;
}

/**
 * Probe hidden site elements and extract their computed colors.
 *
 * `display:block!important` overrides Bootstrap's `.dropdown-menu{display:none}`
 * so `getComputedStyle` returns real values, not hidden-state defaults.
 */
export function probeTheme(options: ProbeOptions): NativeTheme {
	const { panelClass, actionClass, itemHover = "hsla(0,0%,100%,.2)" } = options;

	const probe = document.createElement("div");
	probe.className = panelClass;
	probe.style.cssText =
		"position:fixed;left:-9999px;top:-9999px;visibility:hidden;z-index:-1;display:block!important;opacity:1";
	document.body.appendChild(probe);
	probe.offsetLeft; // force reflow
	const cs = getComputedStyle(probe);
	const theme: NativeTheme = {
		panelBg: cs.backgroundColor,
		panelColor: cs.color,
		itemHover,
		actionBg: "rgb(0,0,0)",
	};
	probe.remove();

	if (actionClass) {
		const probe2 = document.createElement("div");
		probe2.className = actionClass;
		probe2.style.cssText =
			"position:fixed;left:-9999px;top:-9999px;visibility:hidden;z-index:-1;display:inline-block";
		document.body.appendChild(probe2);
		probe2.offsetLeft; // force reflow
		theme.actionBg = getComputedStyle(probe2).backgroundColor;
		probe2.remove();
	} else {
		theme.actionBg = "rgb(0,0,0)";
	}

	return theme;
}
