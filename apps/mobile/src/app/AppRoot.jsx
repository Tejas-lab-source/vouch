// @ts-check
import { compareVersions } from '@vouch/domain';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { AppServicesProvider, useConfig } from '@vouch/features-core';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UpdateRequired } from '../pages/update/UpdateRequired.jsx';
import { APP_VERSION } from '../shared/config/index.js';
import { startMonitoring } from './monitoring.js';
import { createServices } from './services.js';

void SplashScreen.preventAutoHideAsync().catch(() => {});
startMonitoring();

/**
 * The app root: services, the query cache, the session restore from secure storage and the
 * fonts (behind the splash screen), and the forced-update gate (`minSupportedVersion` from `/v1/config`).
 * @param {{ children: import('react').ReactNode }} props
 */
export function AppRoot({ children }) {
  const [services] = useState(createServices);
  const [restored, setRestored] = useState(false);
  // The design's fonts, bundled with the app (no network): Poppins for headings, Inter for text.
  const [fontsLoaded, fontsFailed] = useFonts({
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const fontsReady = fontsLoaded || Boolean(fontsFailed);
  useEffect(() => {
    services.session
      .refresh()
      .catch(() => {})
      .finally(() => setRestored(true));
  }, [services]);
  return (
    // Gestures (the deck swipe) run on the UI thread: the root view hosts their handlers.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={services.queryClient}>
          <AppServicesProvider services={services}>
            <StatusBar style="auto" />
            {restored && fontsReady ? <UpdateGate>{children}</UpdateGate> : null}
          </AppServicesProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Shows the update screen when this build is older than `minSupportedVersion`. @param {{ children: import('react').ReactNode }} props */
function UpdateGate({ children }) {
  const config = useConfig();
  useEffect(() => {
    if (!config.isPending) void SplashScreen.hideAsync().catch(() => {});
  }, [config.isPending]);
  if (config.isPending) return null;
  const minimum = config.data?.minSupportedVersion;
  if (minimum && compareVersions(APP_VERSION, minimum) < 0) return <UpdateRequired />;
  return <>{children}</>;
}
