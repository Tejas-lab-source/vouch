// @ts-check
import { Text, useTheme, Wordmark } from '@vouch/ui-native';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The top of a tab screen: the status-bar inset, then the wordmark or a title, and an optional
 * action on the right (for example Settings).
 * @param {{ title?: string, brand?: boolean, right?: import('react').ReactNode }} props
 */
export function ScreenHeader({ title, brand = false, right = null }) {
  const { colors, space } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: insets.top + space[2],
        paddingHorizontal: space[4],
        paddingBottom: space[2],
        minHeight: 56 + insets.top,
        backgroundColor: colors.background,
      }}
    >
      {brand ? <Wordmark height={30} /> : <Text variant="h1">{title}</Text>}
      {right}
    </View>
  );
}
