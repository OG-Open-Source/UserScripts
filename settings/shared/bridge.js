const REGISTRY_ID = "userscript-registry";
const CHEVRON_SVG =
	'<svg class="us-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
const CHECK_SVG =
	'<svg class="us-select-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>';

const knownScripts = new Map();

export function readScripts() {
	const el = document.getElementById(REGISTRY_ID);
	if (!el?.textContent) return [];
	try {
		const parsed = JSON.parse(el.textContent);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function collectScripts() {
	for (const s of readScripts()) {
		if (s?.id) knownScripts.set(s.id, s);
	}
	return Array.from(knownScripts.values());
}

export function hasScript(id) {
	return collectScripts().some((s) => s.id === id);
}

export function waitForScripts(ms = 1800) {
	return new Promise((resolve) => {
		let settleTimer = null;
		const finish = () => {
			clearTimeout(maxTimer);
			if (settleTimer) clearTimeout(settleTimer);
			window.removeEventListener("userscript:presence", onPresence);
			resolve(collectScripts());
		};
		const onPresence = () => {
			collectScripts();
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(finish, 250);
		};
		const maxTimer = setTimeout(finish, ms);
		window.addEventListener("userscript:presence", onPresence);
		if (collectScripts().length > 0) onPresence();
	});
}

export function onPresence(callback) {
	window.addEventListener("userscript:presence", () => callback(collectScripts()));
}

export function dispatchSettings(detail) {
	window.dispatchEvent(new CustomEvent("userscript:settings", { detail }));
}

let openDropdownClose = null;

document.addEventListener("click", (e) => {
	if (!openDropdownClose) return;
	if (!e.target?.closest?.("[data-us-select]")) {
		openDropdownClose();
	}
});

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && openDropdownClose) {
		openDropdownClose();
	}
});

/**
 * Mounts a Monochrome Hairline custom select inside `container`.
 * Returns `{ getValue, setValue, setOptions, setDisabled }`.
 */
export function createCustomSelect(container, { labelledBy = "", initialValue = "", onChange } = {}) {
	container.classList.add("us-select-wrap");
	container.dataset.usSelect = "1";
	container.innerHTML = "";

	const trigger = document.createElement("button");
	trigger.type = "button";
	trigger.className = "us-select-trigger";
	trigger.setAttribute("aria-haspopup", "listbox");
	trigger.setAttribute("aria-expanded", "false");
	const valueSpan = document.createElement("span");
	if (labelledBy) {
		valueSpan.id = `${container.id || Math.random().toString(36).slice(2, 8)}-val`;
		trigger.setAttribute("aria-labelledby", `${labelledBy} ${valueSpan.id}`);
	}
	trigger.append(valueSpan);
	trigger.insertAdjacentHTML("beforeend", CHEVRON_SVG);

	const menu = document.createElement("div");
	menu.className = "us-select-menu";
	menu.setAttribute("role", "listbox");
	menu.hidden = true;

	container.append(trigger, menu);

	let options = [];
	let currentValue = initialValue;

	function close() {
		menu.hidden = true;
		trigger.setAttribute("aria-expanded", "false");
		if (openDropdownClose === close) openDropdownClose = null;
	}

	function open() {
		if (trigger.disabled || options.length === 0) return;
		if (openDropdownClose && openDropdownClose !== close) openDropdownClose();
		menu.hidden = false;
		trigger.setAttribute("aria-expanded", "true");
		openDropdownClose = close;
	}

	function syncSelected() {
		let matched = options.find((o) => o.value === currentValue) ?? options[0];
		if (matched) currentValue = matched.value;
		valueSpan.textContent = matched ? matched.label : "—";
		for (const btn of menu.querySelectorAll("[role='option']")) {
			btn.setAttribute("aria-selected", String(btn.dataset.value === currentValue));
		}
	}

	function setOptions(nextOptions, emptyText = "No options") {
		options = nextOptions;
		menu.innerHTML = "";
		if (options.length === 0) {
			valueSpan.textContent = emptyText;
			trigger.disabled = true;
			close();
			return;
		}
		trigger.disabled = false;
		for (const opt of options) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "us-select-option";
			btn.setAttribute("role", "option");
			btn.dataset.value = opt.value;
			const label = document.createElement("span");
			label.textContent = opt.label;
			btn.append(label);
			btn.insertAdjacentHTML("beforeend", CHECK_SVG);
			btn.addEventListener("click", () => {
				const prev = currentValue;
				currentValue = opt.value;
				syncSelected();
				close();
				trigger.focus();
				if (prev !== currentValue) onChange?.(currentValue);
			});
			menu.append(btn);
		}
		syncSelected();
	}

	trigger.addEventListener("click", (e) => {
		e.stopPropagation();
		if (menu.hidden) open();
		else close();
	});

	return {
		getValue: () => currentValue,
		setValue(val) {
			currentValue = val;
			syncSelected();
		},
		setOptions,
		setDisabled(disabled) {
			trigger.disabled = Boolean(disabled);
			if (disabled) close();
		},
	};
}
