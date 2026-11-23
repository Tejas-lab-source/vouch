// @ts-check
import { t } from '@vouch/i18n';
import { useTheme } from '@vouch/ui-native';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignInForm } from '../../features/auth/SignInForm.jsx';

export function SignInScreen() {
  const { colors, space, type } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: space[5] }} keyboardShouldPersistTaps="handled">
        <Text
          accessibilityRole="header"
          style={{ color: colors.accent, fontSize: type.display.size, fontWeight: '700' }}
        >
          {t('app.name')}
        </Text>
        <Text style={{ color: colors.textMuted, marginBottom: space[5] }}>{t('app.tagline')}</Text>
        <Text
          accessibilityRole="header"
          style={{
            color: colors.text,
            fontSize: type.title.size,
            fontWeight: '700',
            marginBottom: space[4],
          }}
        >
          {t('auth.title')}
        </Text>
        <SignInForm />
      </ScrollView>
    </SafeAreaView>
  );
}
