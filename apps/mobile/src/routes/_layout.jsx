// @ts-check
import { Stack } from 'expo-router';
import { AppRoot } from '../app/AppRoot.jsx';

/** Expo Router's root: routes are thin; composition lives in src/app (FSD `app` layer). */
export default function RootLayout() {
  return (
    <AppRoot>
      <Stack screenOptions={{ headerShown: false }} />
    </AppRoot>
  );
}
