// @ts-check
import { useSlotItems } from '@vouch/features-core';
import { useTheme } from '@vouch/ui-native';
import { View } from 'react-native';

/** Renders the `home.tabs` item "index" (registered in src/app/features.js). */
export default function Tab() {
  const item = useSlotItems('home.tabs').find((entry) => entry.id === 'index');
  const { colors } = useTheme();
  const Component = item?.component;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Component ? <Component {...(item?.props ?? {})} /> : null}
    </View>
  );
}
