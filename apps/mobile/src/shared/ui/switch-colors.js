// @ts-check

/**
 * React Native Web's Switch takes its "on" thumb colour from a web-only prop; native uses
 * `thumbColor`. Spread this next to `thumbColor` so the web export matches the design too.
 * @param {{ onPrimary: string }} colors
 */
export const SWITCH_WEB = (colors) => /** @type {any} */ ({ activeThumbColor: colors.onPrimary });
