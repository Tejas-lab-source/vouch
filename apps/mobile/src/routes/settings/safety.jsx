// @ts-check
import { t } from '@vouch/i18n';
import { Stack } from 'expo-router';
import { SafetyScreen } from '../../pages/settings/SafetyScreen.jsx';

export default function Safety() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('settings.safety.title') }} />
      <SafetyScreen />
    </>
  );
}
