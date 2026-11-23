// @ts-check
import { t } from '@vouch/i18n';
import { Stack } from 'expo-router';
import { PrivacyScreen } from '../../pages/settings/PrivacyScreen.jsx';

export default function Privacy() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('settings.privacy.title') }} />
      <PrivacyScreen />
    </>
  );
}
