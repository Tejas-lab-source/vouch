// @ts-check
import { t } from '@vouch/i18n';
import { privacyNotice } from '@vouch/i18n/privacy-notice';
import { Text, useTheme } from '@vouch/ui-native';
import { View } from 'react-native';

/**
 * The full privacy notice for a version (Phase 14), or "update the app" when this build does
 * not ship it. The caller provides the scrolling container.
 * @param {{ version: string | null | undefined }} props
 */
export function PrivacyNoticeText({ version }) {
  const { colors, space } = useTheme();
  const notice = privacyNotice(version);
  const body = { marginBottom: space[2] };
  if (!notice) {
    return (
      <Text accessibilityRole="alert" color={colors.dangerText} style={body}>
        {t('privacy.notice.unavailable')}
      </Text>
    );
  }
  return (
    <View>
      <Text variant="caption" muted style={body}>
        {t('privacy.version', { version: notice.version })} ·{' '}
        {t('privacy.notice.effective', { date: notice.effectiveDate })}
        {notice.status === 'draft' ? ` · ${t('privacy.notice.draft')}` : ''}
      </Text>
      {notice.sections.map((section) => (
        <View key={section.heading}>
          <Text variant="label" accessibilityRole="header" style={{ ...body, marginTop: space[2] }}>
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
