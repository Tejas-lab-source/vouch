// @ts-check
import { t } from '@vouch/i18n';
import { Text, useTheme } from '@vouch/ui-native';
import { ScrollView } from 'react-native';

/** Safety tips and how to report. */
export function SafetyScreen() {
  const { colors, space } = useTheme();
  const body = { marginBottom: space[3] };
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
    >
      <Text variant="h2" style={body}>
        {t('safety.tips.title')}
      </Text>
      {['safety.tips.one', 'safety.tips.two', 'safety.tips.three', 'safety.tips.four'].map(
        (key) => (
          <Text key={key} style={body}>
            • {t(/** @type {any} */ (key))}
          </Text>
        ),
      )}
      <Text variant="h2" style={{ ...body, fontSize: 18 }}>
        {t('safety.howToReport.title')}
      </Text>
      <Text style={body}>{t('safety.howToReport.body')}</Text>
    </ScrollView>
  );
}
