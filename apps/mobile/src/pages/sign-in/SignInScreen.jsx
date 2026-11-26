// @ts-check
import { t } from '@vouch/i18n';
import { Button, Text, useTheme, Wordmark } from '@vouch/ui-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SignInForm } from '../../features/auth/SignInForm.jsx';
import { CampusIllustration } from '../../shared/ui/Illustration.jsx';

/**
 * Sign-in. A welcome first (wordmark, motto, campus art); both "Get started" and "I already
 * have an account" lead to the same college-email form: sign-up and sign-in are one flow.
 */
export function SignInScreen() {
  const { colors, space } = useTheme();
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            padding: space[5],
            justifyContent: 'space-between',
          }}
        >
          <View style={{ alignItems: 'center', gap: space[2], marginTop: space[8] }}>
            <Wordmark height={72} />
            <Text variant="h2" style={{ textAlign: 'center' }}>
              {t('brand.motto')}
            </Text>
            <Text muted style={{ textAlign: 'center' }}>
              {t('brand.audience')}
            </Text>
          </View>
          <CampusIllustration width={340} />
          <View style={{ gap: space[3] }}>
            <Button title={t('auth.welcome.start')} block onPress={() => setStarted(true)} />
            <Button
              title={t('auth.welcome.signIn')}
              variant="ghost"
              block
              onPress={() => setStarted(true)}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: space[5] }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: space[5] }}>
          <Wordmark height={44} />
        </View>
        <SignInForm />
      </ScrollView>
    </SafeAreaView>
  );
}
