// @ts-check
import { t } from '@vouch/i18n';
import { useTheme } from '@vouch/ui-native';
import { ScrollView, Text } from 'react-native';

/** Safety tips and how to report. */
export function SafetyScreen() {
  const { colors, space } = useTheme();
  const body = { color: colors.text, marginBottom: space[2] };
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
    >
      <Text accessibilityRole="header" style={{ ...body, fontSize: 20, fontWeight: '700' }}>
        {t('safety.tips.title')}
      </Text>
      {['safety.tips.one', 'safety.tips.two', 'safety.tips.three', 'safety.tips.four'].map(
        (key) => (
          <Text key={key} style={body}>
            • {t(/** @type {any} */ (key))}
          </Text>
        ),
      )}
      <Text accessibilityRole="header" style={{ ...body, fontWeight: '700' }}>
        {t('safety.howToReport.title')}
      </Text>
      <Text style={body}>{t('safety.howToReport.body')}</Text>
    </ScrollView>
  );
}
