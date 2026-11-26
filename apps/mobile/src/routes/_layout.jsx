// @ts-check
import { font, useTheme } from '@vouch/ui-native';
import { Stack } from 'expo-router';
import { AppRoot } from '../app/AppRoot.jsx';

/** Expo Router's root: routes are thin; composition lives in src/app (FSD `app` layer). */
export default function RootLayout() {
  const { colors } = useTheme();
  return (
    <AppRoot>
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: font('h2').fontFamily, fontSize: 18, color: colors.text },
          contentStyle: { backgroundColor: colors.background },
        }}
      />
    </AppRoot>
  );
}
