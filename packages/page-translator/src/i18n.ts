/**
 * Default English strings for Page Translator.
 * Additional languages live in ../locales.json.
 */
export const MESSAGES_EN = {
	translatePage: "Translate Page",
	restorePage: "Restore Original",
	inspectMode: "Capture Preview: {state}",
	volunteerMode: "Volunteer Mode: {state}",
	volunteerBlockClicks: "Volunteer Click Lock: {state}",
	openSettings: "Open Settings",
	on: "ON",
	off: "OFF",
	translating: "Translating...",
	translated: "Translated",
	error: "Translation failed",
} as const;

export type MessageKey = keyof typeof MESSAGES_EN;
