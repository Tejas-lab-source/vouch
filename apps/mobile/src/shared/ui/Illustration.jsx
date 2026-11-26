// @ts-check
import { useTheme } from '@vouch/ui-native';
import { View } from 'react-native';
import { Circle, Ellipse, G, Path, Rect, Svg, Text as SvgText } from 'react-native-svg';

/**
 * PLACEHOLDER ILLUSTRATION (design update): a simple campus skyline standing in for the final
 * "college" art (the same drawing as packages/ui-web/assets/campus-placeholder.svg). Replace
 * this component's drawing with the real art; keep the name. Decorative: hidden from screen
 * readers, and never placed behind text.
 * @param {{ width?: number }} props
 */
export function CampusIllustration({ width = 320 }) {
  const { scheme } = useTheme();
  const opacity = scheme === 'dark' ? 0.55 : 0.9;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignSelf: 'center' }}
    >
      <Svg width={width} height={(width * 260) / 640} viewBox="0 0 640 260">
        <Ellipse cx="320" cy="250" rx="320" ry="22" fill="#F4C9A8" opacity={0.55 * opacity} />
        <G fill="#E9A47C" opacity={opacity}>
          <Rect x="150" y="120" width="340" height="120" rx="6" />
          <Rect x="275" y="70" width="90" height="170" rx="4" />
          <Path d="M270 74 320 18 370 74z" />
          <Rect x="110" y="150" width="60" height="90" rx="4" />
          <Rect x="470" y="150" width="60" height="90" rx="4" />
          <Circle cx="140" cy="150" r="30" />
          <Circle cx="500" cy="150" r="30" />
        </G>
        <G fill="#FFF7F0" opacity={opacity}>
          <Path d="M180 240v-46a14 14 0 0 1 28 0v46zM228 240v-46a14 14 0 0 1 28 0v46zM384 240v-46a14 14 0 0 1 28 0v46zM432 240v-46a14 14 0 0 1 28 0v46z" />
          <Path d="M302 240v-60a18 18 0 0 1 36 0v60z" />
          <Circle cx="320" cy="110" r="14" />
        </G>
        <G fill="#9BB37A" opacity={opacity}>
          <Circle cx="60" cy="200" r="34" />
          <Rect x="56" y="200" width="8" height="40" />
          <Circle cx="585" cy="196" r="38" />
          <Rect x="581" y="196" width="8" height="44" />
        </G>
        <Path d="M314 16h12M320 10v12" stroke="#D62828" strokeWidth="3" strokeLinecap="round" />
        <SvgText x="632" y="252" textAnchor="end" fontSize="10" fill="#B07A5E" opacity={0.8}>
          placeholder art
        </SvgText>
      </Svg>
    </View>
  );
}
