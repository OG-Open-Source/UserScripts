# `oklch()` CSS Function

- **URL Source:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/oklch
- **Baseline:** Widely available (since May 2023)

The `oklch()` functional notation expresses a color in the Oklab color space using cylindrical coordinates: perceptual lightness (`L`), chroma (`C`), and hue (`H`), with an optional alpha channel (`A`).

## Syntax

```css
/* Absolute values */
oklch(L C H)
oklch(L C H / A)

/* Examples */
oklch(55.22% 0.2201 299.38)       /* #8844DD Purple */
oklch(86.66% 0.1647 88.68)        /* #FFCC33 Yellow */
oklch(55.94% 0.1900 25.86)        /* #CC3333 Red */
oklch(52.20% 0.1771 255.83)       /* #0066CC Blue */
oklch(56.86% 0.0566 263.97)       /* #667799 Gray */
oklch(74.27% 0.2039 146.60)       /* #33CC55 Green */
oklch(52.20% 0.1771 255.83 / 0.5) /* 50% alpha */

/* Relative color syntax */
oklch(from var(--color) calc(l + 0.1) c h)
oklch(from var(--color) l c h / calc(alpha - 0.1))
```

## Values

- **`L` (Lightness)**: `<number>` in `[0, 1]`, `<percentage>` in `[0%, 100%]`, or `none`. `0` / `0%` is black; `1` / `100%` is white. Represents perceptual lightness.
- **`C` (Chroma)**: `<number>`, `<percentage>` (where `100%` equals `0.4`), or `none`. Minimum useful value is `0`; practical sRGB/P3 values sit below `0.4`–`0.5`.
- **`H` (Hue)**: `<number>`, `<angle>`, or `none` (`0deg`–`360deg` in the Oklab hue wheel).
- **`A` (Alpha, optional)**: `<number>` in `[0, 1]`, `<percentage>` in `[0%, 100%]`, or `none`, preceded by `/`.

## Relative Color Output Channels

Inside `oklch(from <color> ...)`, the origin color is converted to Oklab/Oklch and exposes `l` (`0`–`1`), `c` (`0`–`0.4`), `h` (`0`–`360`), and `alpha` (`0`–`1`) as `<number>` values for `calc()`.

> Note: Because relative channel variables resolve to `<number>`, add numbers (e.g. `calc(l + 0.15)`), not percentages.
