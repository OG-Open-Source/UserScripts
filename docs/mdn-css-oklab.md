# `oklab()` CSS Function

- **URL Source:** https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/oklab
- **Baseline:** Widely available (since May 2023)

The `oklab()` functional notation expresses a color in the perceptual Oklab color space using Cartesian coordinates: perceptual lightness (`L`), green-red axis (`a`), and blue-yellow axis (`b`), with an optional alpha channel (`A`).

## Syntax

```css
/* Absolute values */
oklab(L a b)
oklab(L a b / A)

/* Examples */
oklab(55.22% 0.1080 -0.1918)       /* #8844DD Purple */
oklab(86.66% 0.0038 0.1646)        /* #FFCC33 Yellow */
oklab(55.94% 0.1709 0.0829)        /* #CC3333 Red */
oklab(52.20% -0.0434 -0.1717)      /* #0066CC Blue */
oklab(56.86% -0.0060 -0.0563)      /* #667799 Gray */
oklab(74.27% -0.1703 0.1123)       /* #33CC55 Green */
oklab(52.20% -0.0434 -0.1717 / .4) /* 40% alpha */

/* Relative color syntax */
oklab(from var(--color) calc(l + 0.15) a b)
oklab(from var(--color) l a b / calc(alpha * 0.9))
```

## Values

- **`L` (Lightness)**: `<number>` in `[0, 1]`, `<percentage>` in `[0%, 100%]`, or `none`. `0` / `0%` is black; `1` / `100%` is white.
- **`a` (Green–Red axis)**: `<number>` (typically `-0.4` to `0.4`), `<percentage>` (`-100%` to `100%`), or `none`. Negative values shift toward green; positive values shift toward red.
- **`b` (Blue–Yellow axis)**: `<number>` (typically `-0.4` to `0.4`), `<percentage>` (`-100%` to `100%`), or `none`. Negative values shift toward blue; positive values shift toward yellow.
- **`A` (Alpha, optional)**: `<number>` in `[0, 1]`, `<percentage>` in `[0%, 100%]`, or `none`, preceded by `/`.

## Perceptual Usage Notes

- Ideal for generating neutral tonal scales tinted by a chromaticity core `(a_style, b_style)` without shifting perceived lightness.
- Relative color channels expose `l` (`0`–`1`), `a` (`-0.4`–`0.4`), `b` (`-0.4`–`0.4`), and `alpha` (`0`–`1`) as `<number>` values.
