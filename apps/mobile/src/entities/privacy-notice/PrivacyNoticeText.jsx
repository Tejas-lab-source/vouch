// @ts-check
import { t } from '@vouch/i18n';
import { privacyNotice } from '@vouch/i18n/privacy-notice';
import { useTheme } from '@vouch/ui-native';
import { Text, View } from 'react-native';

/**
 * The full privacy notice for a version (Phase 14), or "update the app" when this build does
 * not ship it. The caller provides the scrolling container.
 * @param {{ version: string | null | undefined }} props
 */
export function PrivacyNoticeText({ version }) {
  const { colors, space } = useTheme();
  const notice = privacyNotice(version);
  const body = { color: colors.text, marginBottom: space[2], lineHeight: 22 };
  if (!notice) {
    return (
      <Text accessibilityRole="alert" style={{ ...body, color: colors.danger }}>
        {t('privacy.notice.unavailable')}
      </Text>
    );
  }
  return (
    <View>
      <Text style={{ ...body, color: colors.textMuted }}>
        {t('privacy.version', { version: notice.version })} ·{' '}
        {t('privacy.notice.effective', { date: notice.effectiveDate })}
        {notice.status === 'draft' ? ` · ${t('privacy.notice.draft')}` : ''}
      </Text>
      {notice.sections.map((section) => (
        <View key={section.heading}>
          <Text accessibilityRole="header" style={{ ...body, fontWeight: '700' }}>
            {section.heading}
          </Text>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph.slice(0, 40)} style={body}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
