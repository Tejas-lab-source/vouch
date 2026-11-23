// @ts-check
import { t } from '@vouch/i18n';
import { Stack } from 'expo-router';
import { SettingsScreen } from '../../pages/settings/SettingsScreen.jsx';

export default function Settings() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('settings.title') }} />
      <SettingsScreen />
    </>
  );
}
