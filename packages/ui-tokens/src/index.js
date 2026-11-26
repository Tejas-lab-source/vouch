// @ts-check

/**
 * Design tokens: Direction E, "Modern Indian, trustworthy, fun" (docs/design/design-system.md,
 * the source of truth). Every brand value is here, once: the web CSS variables, the native
 * theme and the landing page read these. A test checks every text/background pair the
 * components use against WCAG AA in both themes.
 */

/** Spacing scale in px: 4, 8, 12, 16, 24, 32, 40, 48. */
export const space = Object.freeze({ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 40, 8: 48 });

/** Corner radii in px. */
export const radius = Object.freeze({
  sm: 8,
  md: 12,
  card: 16,
  input: 16,
  chip: 20,
  bubble: 20,
  button: 24,
  modal: 24,
  pill: 999,
});

/** The two font families (self-hosted; see `fontFiles`). */
export const fonts = Object.freeze({ heading: 'Poppins', body: 'Inter' });

/**
 * Type scale: family, size and line height in px, weight. `h1`, `h2`, `body` and `caption` are
 * the spec; `label` (buttons, list titles) is derived from body.
 * @typedef {{ family: 'heading' | 'body', size: number, lineHeight: number, weight: 400 | 500 | 600 | 700 }} TypeStyle
 */
export const type = Object.freeze({
  h1: { family: 'heading', size: 30, lineHeight: 38, weight: 700 },
  h2: { family: 'heading', size: 20, lineHeight: 28, weight: 600 },
  body: { family: 'body', size: 15, lineHeight: 22, weight: 400 },
  label: { family: 'body', size: 15, lineHeight: 20, weight: 600 },
  caption: { family: 'body', size: 12, lineHeight: 16, weight: 500 },
});

/**
 * Native font family names per family and weight (React Native picks a file by name, not by
 * `fontWeight`): the names `@expo-google-fonts/*` registers.
 */
export const nativeFontFamily = Object.freeze({
  heading: Object.freeze({ 600: 'Poppins_600SemiBold', 700: 'Poppins_700Bold' }),
  body: Object.freeze({
    400: 'Inter_400Regular',
    500: 'Inter_500Medium',
    600: 'Inter_600SemiBold',
  }),
});

/** The font stacks for CSS (system fonts while the web fonts load). */
export const fontStack = Object.freeze({
  heading: "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif",
});

/** @deprecated The body stack; kept for callers of the Phase 11 name. */
export const fontFamily = fontStack.body;

/** Shadows (CSS) for cards, buttons and modals; inputs have none, only a 1px border. */
export const shadow = Object.freeze({
  card: '0 6px 16px rgba(0,0,0,0.10)',
  button: '0 2px 8px rgba(0,0,0,0.08)',
  modal: '0 12px 32px rgba(0,0,0,0.16)',
});

/** The same shadows for React Native (iOS shadow props and the Android elevation). */
export const nativeShadow = Object.freeze({
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  button: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 32,
    elevation: 12,
  },
});

/** Icons: Lucide outline at this stroke width. */
export const icon = Object.freeze({ strokeWidth: 1.8, size: 22 });

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
 * The spec colours are `primary`, `secondary`, `background`, `surface`, `text`, `textMuted`,
 * `success` and `danger` (error). `*Text` variants are the colour to use for text and
 * outlines on the theme's backgrounds; where a spec colour is under 4.5:1 there, the variant
 * is the smallest lightness change that passes (docs/design/design-system.md lists each).
 * @typedef {{
 *   primary: string, primaryPressed: string, primaryDisabled: string, onPrimary: string, primaryText: string,
 *   secondary: string, onSecondary: string, primaryOnSecondary: string,
 *   background: string, surface: string, surfaceMuted: string,
 *   border: string, borderSubtle: string,
 *   text: string, textMuted: string,
 *   success: string, successText: string, successSoft: string,
 *   warningText: string, warningSoft: string,
 *   danger: string, dangerPressed: string, onDanger: string, dangerText: string, dangerSoft: string,
 *   focus: string, scrim: string,
 *   celebrateFrom: string, celebrateTo: string,
 * }} Theme
 */

/** @type {Readonly<Theme>} */
export const light = Object.freeze({
  primary: '#D62828',
  primaryPressed: '#BE2424',
  primaryDisabled: '#EBA9A9',
  onPrimary: '#FFFFFF',
  primaryText: '#D62828',
  secondary: '#F8D7DA',
  onSecondary: '#1F2937',
  primaryOnSecondary: '#BE2424',
  background: '#FFF7F0',
  surface: '#FFFFFF',
  surfaceMuted: '#F6EDE6',
  border: '#8791A1',
  borderSubtle: '#EEDFD6',
  text: '#1F2937',
  textMuted: '#6B7280',
  success: '#16A34A',
  successText: '#11813B',
  successSoft: '#DCFCE7',
  warningText: '#92400E',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerPressed: '#B91C1C',
  onDanger: '#FFFFFF',
  dangerText: '#CA2121',
  dangerSoft: '#FEE2E2',
  focus: '#D62828',
  scrim: 'rgba(17, 12, 10, 0.55)',
  celebrateFrom: '#8E1B1B',
  celebrateTo: '#3B0E0E',
});

/** @type {Readonly<Theme>} */
export const dark = Object.freeze({
  primary: '#D62828',
  primaryPressed: '#B01E1E',
  primaryDisabled: '#5A2525',
  onPrimary: '#FFFFFF',
  primaryText: '#E26666',
  secondary: '#3B1F1F',
  onSecondary: '#FFFFFF',
  primaryOnSecondary: '#E26666',
  background: '#0B0B0F',
  surface: '#1F1F24',
  surfaceMuted: '#2A2A30',
  border: '#696975',
  borderSubtle: '#2E2E35',
  text: '#FFFFFF',
  textMuted: '#9CA3AF',
  success: '#16A34A',
  successText: '#16A34A',
  successSoft: '#0F2A1A',
  warningText: '#FBBF24',
  warningSoft: '#3A2A0A',
  danger: '#DC2626',
  dangerPressed: '#B91C1C',
  onDanger: '#FFFFFF',
  dangerText: '#E66363',
  dangerSoft: '#3B1F1F',
  focus: '#E26666',
  scrim: 'rgba(0, 0, 0, 0.7)',
  celebrateFrom: '#7A1616',
  celebrateTo: '#1F0808',
});

export const themes = Object.freeze({ light, dark });

/**
 * The text/background pairs the components use, and the ratio each must meet:
 * [foreground, background, min]. 4.5 for text, 3 for outlines, icons and focus rings.
 * @type {readonly [keyof Theme, keyof Theme, number][]}
 */
export const CONTRAST_PAIRS = Object.freeze([
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['text', 'secondary', 4.5],
  ['onSecondary', 'secondary', 4.5],
  ['primaryOnSecondary', 'secondary', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['onPrimary', 'primary', 4.5],
  ['onPrimary', 'primaryPressed', 4.5],
  ['onDanger', 'danger', 4.5],
  ['onDanger', 'dangerPressed', 4.5],
  ['primaryText', 'background', 4.5],
  ['primaryText', 'surface', 4.5],
  ['dangerText', 'background', 4.5],
  ['dangerText', 'surface', 4.5],
  ['dangerText', 'dangerSoft', 4.5],
  ['successText', 'background', 4.5],
  ['successText', 'surface', 4.5],
  ['successText', 'successSoft', 4.5],
  ['warningText', 'warningSoft', 4.5],
  ['warningText', 'surface', 4.5],
  ['primary', 'background', 3],
  ['primary', 'surface', 3],
  ['success', 'surface', 3],
  ['border', 'background', 3],
  ['border', 'surface', 3],
  ['focus', 'background', 3],
  ['focus', 'surface', 3],
  ['onPrimary', 'celebrateFrom', 4.5],
  ['onPrimary', 'celebrateTo', 4.5],
]);

/** Pairs that differ by theme: the pressed secondary button (red text on pink). */
export const THEME_PAIRS = Object.freeze({
  light: /** @type {readonly [keyof Theme, keyof Theme, number][]} */ ([
    ['primaryPressed', 'secondary', 4.5],
  ]),
  dark: /** @type {readonly [keyof Theme, keyof Theme, number][]} */ ([
    ['primaryText', 'secondary', 4.5],
  ]),
});

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
      `  --type-${k}-family: var(--font-${v.family});`,
      `  --type-${k}-size: ${v.size}px;`,
      `  --type-${k}-line: ${v.lineHeight}px;`,
      `  --type-${k}-weight: ${v.weight};`,
    ]),
    ...Object.entries(shadow).map(([k, v]) => `  --shadow-${k}: ${v};`),
    `  --font-heading: ${fontStack.heading};`,
    `  --font-body: ${fontStack.body};`,
    `  --icon-stroke: ${icon.strokeWidth};`,
    `  --motion-fast: ${motion.fast}ms;`,
    `  --motion-base: ${motion.base}ms;`,
    `  --motion-slow: ${motion.slow}ms;`,
    `  --motion-easing: ${motion.easing};`,
    `  --touch-target: ${minTouchTarget}px;`,
  ].join('\n');
  return [
    `:root {\n  color-scheme: light;\n${colours(light)}\n${scales}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme='light']) {\n    color-scheme: dark;\n${colours(dark).replace(/^/gm, '  ')}\n  }\n}`,
    `:root[data-theme='dark'] {\n  color-scheme: dark;\n${colours(dark)}\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  :root {\n    --motion-fast: 0ms;\n    --motion-base: 0ms;\n    --motion-slow: 0ms;\n  }\n}`,
  ].join('\n\n');
}

/**
 * The "Vouch" wordmark with its heart, as SVG paths (Poppins Bold Italic outlines, so it needs
 * no font): one source for the web, mobile and the landing page. The letters take the text
 * colour they are given (primary on light, `primaryText` on dark); the heart is primary.
 */
export const wordmark = Object.freeze({
  viewBox: '40 -1000 3560 1040',
  letters:
    'M264 -702 345 -172 612 -702H794L421 0H207L82 -702Z M731 -226Q731 -321 776 -399Q821 -477 900 -521Q979 -566 1076 -566Q1148 -566 1205 -536Q1261 -507 1292 -454Q1323 -401 1323 -331Q1323 -235 1278 -157Q1232 -80 1153 -36Q1073 8 976 8Q904 8 848 -21Q792 -50 762 -103Q731 -156 731 -226ZM1146 -315Q1146 -365 1119 -392Q1092 -419 1051 -419Q1008 -419 976 -393Q943 -368 925 -327Q907 -286 907 -241Q907 -192 933 -165Q959 -139 1000 -139Q1042 -139 1076 -164Q1109 -190 1128 -230Q1146 -271 1146 -315Z M1987 -558 1889 0H1718L1731 -76Q1698 -39 1651 -16Q1603 6 1549 6Q1465 6 1417 -41Q1369 -89 1369 -174Q1369 -206 1374 -232L1432 -558H1602L1549 -255Q1546 -239 1546 -224Q1546 -182 1570 -159Q1593 -137 1635 -137Q1683 -137 1717 -165Q1750 -194 1761 -247L1816 -558Z M2338 -566Q2443 -566 2504 -511Q2565 -456 2569 -356H2387Q2376 -420 2309 -420Q2262 -420 2228 -383Q2194 -347 2182 -279Q2178 -258 2178 -235Q2178 -188 2200 -163Q2222 -138 2260 -138Q2326 -138 2359 -202H2542Q2503 -104 2422 -48Q2341 8 2237 8Q2129 8 2066 -51Q2002 -111 2002 -214Q2002 -245 2008 -279Q2023 -366 2070 -431Q2117 -496 2187 -531Q2256 -566 2338 -566Z M3196 -386Q3196 -358 3190 -326L3132 0H2962L3016 -303Q3019 -320 3019 -333Q3019 -375 2996 -398Q2972 -421 2930 -421Q2880 -421 2846 -390Q2812 -359 2802 -303V-305L2748 0H2577L2708 -740H2879L2834 -484Q2867 -521 2915 -542Q2963 -564 3019 -564Q3101 -564 3149 -517Q3196 -470 3196 -386Z',
  heart:
    'M3376 -666C3376 -666 3197 -729 3175 -834C3164 -884 3194 -932 3242 -942C3272 -949 3302 -939 3322 -919C3332 -946 3356 -966 3385 -973C3434 -983 3480 -951 3491 -901C3513 -796 3376 -666 3376 -666Z',
});
