# Local Font Access API

- **URL Source:** https://developer.mozilla.org/en-US/docs/Web/API/Local_Font_Access_API

## Concepts and usage

The [`Window.queryLocalFonts()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts) method provides access to an array of locally-installed fonts, each represented by a [`FontData`](https://developer.mozilla.org/en-US/docs/Web/API/FontData) object instance (`postscriptName`, `fullName`, `family`, `style`, and `blob()`).

- Requires user activation (`Window.queryLocalFonts()` triggers the `local-fonts` browser permission prompt).
- Feature detection: `"queryLocalFonts" in window`.
- Not supported in all browsers (e.g., Firefox); always keep a text input fallback.
