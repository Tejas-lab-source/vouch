// @ts-check
import { compareVersions } from '@vouch/domain';
import { AppServicesProvider, useConfig } from '@vouch/features-core';
import { QueryClientProvider } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UpdateRequired } from '../pages/update/UpdateRequired.jsx';
import { APP_VERSION } from '../shared/config/index.js';
import { createServices } from './services.js';

void SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * The app root: services, the query cache, the session restore from secure storage (behind
 * the splash screen), and the forced-update gate (`minSupportedVersion` from `/v1/config`).
 * @param {{ children: import('react').ReactNode }} props
 */
export function AppRoot({ children }) {
  const [services] = useState(createServices);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    services.session
      .refresh()
      .catch(() => {})
      .finally(() => setRestored(true));
  }, [services]);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={services.queryClient}>
        <AppServicesProvider services={services}>
          <StatusBar style="auto" />
          {restored ? <UpdateGate>{children}</UpdateGate> : null}
        </AppServicesProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
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
