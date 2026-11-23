// @ts-check

/**
 * Design tokens (Phase 11). The brand is not decided yet: the name is "Vouch" and the palette
 * is a neutral placeholder with one accent, chosen so every text/background pair meets WCAG AA
 * (4.5:1 for text, 3:1 for large text and UI). A test checks the pairs.
 */

/** Spacing scale in px (4-point grid). */
export const space = Object.freeze({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64 });

/** Corner radii in px. */
export const radius = Object.freeze({ sm: 6, md: 10, lg: 16, pill: 999 });

/** Type scale: size and line height in px, weight. */
export const type = Object.freeze({
  caption: { size: 12, lineHeight: 16, weight: 400 },
  body: { size: 16, lineHeight: 24, weight: 400 },
  label: { size: 14, lineHeight: 20, weight: 600 },
  title: { size: 20, lineHeight: 28, weight: 700 },
  display: { size: 28, lineHeight: 36, weight: 700 },
});

/** The font stack: system fonts (no font download). */
export const fontFamily =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

/** Motion durations in ms and the easing. Reduced motion turns durations to 0. */
export const motion = Object.freeze({
  fast: 120,
  base: 200,
  slow: 320,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
});

/** The smallest touch target in px (WCAG 2.5.5 / platform guidelines). */
export const minTouchTarget = 44;

/**
 * Colour themes. Keys are semantic, never literal colours, so components work in both.
 * @typedef {{ background: string, surface: string, surfaceMuted: string, border: string, text: string, textMuted: string, accent: string, onAccent: string, danger: string, onDanger: string, success: string, focus: string }} Theme
 */

/** @type {Readonly<Theme>} */
export const light = Object.freeze({
  background: '#ffffff',
  surface: '#f6f6f7',
  surfaceMuted: '#ececee',
  border: '#8a8a93',
  text: '#16161a',
  textMuted: '#55555f',
  accent: '#4338ca',
  onAccent: '#ffffff',
  danger: '#b42318',
  onDanger: '#ffffff',
  success: '#1a7f37',
  focus: '#2563eb',
});

/** @type {Readonly<Theme>} */
export const dark = Object.freeze({
  background: '#121216',
  surface: '#1c1c22',
  surfaceMuted: '#27272f',
  border: '#7c7c87',
  text: '#f4f4f6',
  textMuted: '#b4b4bd',
  accent: '#a5b4fc',
  onAccent: '#16161a',
  danger: '#fca5a5',
  onDanger: '#16161a',
  success: '#86efac',
  focus: '#93c5fd',
});

export const themes = Object.freeze({ light, dark });

/**
 * The text/background pairs that must meet a contrast ratio: [foreground, background, min].
 * @type {readonly [keyof Theme, keyof Theme, number][]}
 */
export const CONTRAST_PAIRS = Object.freeze([
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['onAccent', 'accent', 4.5],
  ['onDanger', 'danger', 4.5],
  ['accent', 'background', 3],
  ['danger', 'background', 4.5],
  ['border', 'background', 3],
  ['focus', 'background', 3],
]);

/** Relative luminance of `#rrggbb` (WCAG 2.x). @param {string} hex */
export function luminance(hex) {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** WCAG contrast ratio of two colours. @param {string} a @param {string} b */
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

/** @param {string} name camelCase */
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * CSS custom properties for the web: `:root` holds the light theme and the scales;
 * `prefers-color-scheme: dark` and `[data-theme="dark"]` switch colours; reduced motion zeroes
 * durations.
 */
export function cssVariables() {
  /** @param {Theme} theme */
  const colours = (theme) =>
    Object.entries(theme)
      .map(([key, value]) => `  --color-${kebab(key)}: ${value};`)
      .join('\n');
  const scales = [
    ...Object.entries(space).map(([k, v]) => `  --space-${k}: ${v}px;`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    ...Object.entries(type).flatMap(([k, v]) => [
      `  --type-${k}-size: ${v.size}px;`,
      `  --type-${k}-line: ${v.lineHeight}px;`,
      `  --type-${k}-weight: ${v.weight};`,
    ]),
    `  --font-family: ${fontFamily};`,
    `  --motion-fast: ${motion.fast}ms;`,
    `  --motion-base: ${motion.base}ms;`,
    `  --motion-slow: ${motion.slow}ms;`,
    `  --motion-easing: ${motion.easing};`,
    `  --touch-target: ${minTouchTarget}px;`,
  ].join('\n');
  return [
    `:root {\n  color-scheme: light dark;\n${colours(light)}\n${scales}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n${colours(dark).replace(/^/gm, '  ')}\n  }\n}`,
    `:root[data-theme='dark'] {\n${colours(dark)}\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  :root {\n    --motion-fast: 0ms;\n    --motion-base: 0ms;\n    --motion-slow: 0ms;\n  }\n}`,
  ].join('\n\n');
}
