// @ts-check
import {
  dark,
  icon,
  light,
  minTouchTarget,
  nativeFontFamily,
  nativeShadow,
  radius,
  space,
  type,
} from '@vouch/ui-tokens';
import { useColorScheme } from 'react-native';

/**
 * The React Native text style for a type token: the font file for its family and weight (React
 * Native picks fonts by name, so `fontWeight` is not set), size and line height.
 * @param {keyof typeof type} name
 * @param {400 | 500 | 600 | 700} [weight]  Overrides the token's weight.
 */
export function font(name, weight) {
  const style = /** @type {import('@vouch/ui-tokens').TypeStyle} */ (STYLES.get(name));
  const files = FILES.get(style.family) ?? new Map();
  const fontFamily = files.get(weight ?? style.weight) ?? files.get(style.weight);
  return { fontFamily, fontSize: style.size, lineHeight: style.lineHeight };
}

const STYLES = new Map(Object.entries(type));
/** @type {Map<string, Map<number, string>>} */
const FILES = new Map(
  Object.entries(nativeFontFamily).map(([family, byWeight]) => [
    family,
    new Map(Object.entries(byWeight).map(([w, file]) => [Number(w), file])),
  ]),
);

/** The token theme for the system appearance (light or dark). */
export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = scheme === 'dark' ? dark : light;
  return { scheme, colors, space, radius, type, font, shadow: nativeShadow, icon, minTouchTarget };
}

/** @typedef {ReturnType<typeof useTheme>} NativeTheme */
