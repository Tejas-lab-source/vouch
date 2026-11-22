// @ts-check
import { dark, light, minTouchTarget, radius, space, type } from '@vouch/ui-tokens';
import { useColorScheme } from 'react-native';

/** The token theme for the system appearance (light or dark). */
export function useTheme() {
  const colors = useColorScheme() === 'dark' ? dark : light;
  return { colors, space, radius, type, minTouchTarget };
}

/** @typedef {ReturnType<typeof useTheme>} NativeTheme */
