// @ts-check
import { useConfig } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { useTheme } from '@vouch/ui-native';
import { ScrollView, Text } from 'react-native';
import { PrivacyNoticeText } from '../../entities/privacy-notice/PrivacyNoticeText.jsx';
import { GRIEVANCE_EMAIL } from '../../shared/config/index.js';

/** The privacy notice in full (the version the server names) and the grievance contact. */
export function PrivacyScreen() {
  const { colors, space } = useTheme();
  const config = useConfig();
  const body = { color: colors.text, marginBottom: space[2] };
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
    >
      <Text style={body}>{t('privacy.summary')}</Text>
      <PrivacyNoticeText version={config.data?.privacyNoticeVersion} />
      <Text accessibilityRole="header" style={{ ...body, fontWeight: '700' }}>
        {t('privacy.grievance.title')}
      </Text>
      <Text style={body}>{t('privacy.grievance.body', { email: GRIEVANCE_EMAIL })}</Text>
    </ScrollView>
  );
}
