// @ts-check
import { isAdult, isEmail, isIsoDate, isOtp } from '@vouch/domain';
import { errorKey, useConfig, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { privacyNotice } from '@vouch/i18n/privacy-notice';
import { Button, Input, OtpInput, Sheet, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { PrivacyNoticeText } from '../../entities/privacy-notice/PrivacyNoticeText.jsx';

/** Sign-in on mobile: the same steps and rules as the web (shared flow in features-core). */
export function SignInForm() {
  const { auth } = useServices();
  const config = useConfig();
  const { colors, space } = useTheme();
  const [state, setState] = useState(/** @type {any} */ ({ step: 'signedOut' }));
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const noticeVersion = config.data?.privacyNoticeVersion ?? null;
  // Consent is only asked for a notice this build can show (Phase 14).
  const noticeShown = privacyNotice(noticeVersion) !== null;
  const [readingNotice, setReadingNotice] = useState(false);

  /** @param {() => Promise<any>} action */
  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      if (next) setState(next);
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  if (state.step === 'signedOut') {
    return (
      <View>
        <Input
          label={t('auth.email.label')}
          placeholder={t('auth.email.placeholder')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          error={error}
        />
        <Button
          title={t('common.continue')}
          loading={busy}
          onPress={() =>
            isEmail(email)
              ? void run(() => auth.requestCode(email.trim()))
              : setError(t('auth.email.invalid'))
          }
        />
      </View>
    );
  }
  if (state.step === 'codeSent') {
    return (
      <View>
        <Text style={{ color: colors.text, marginBottom: space[3] }}>
          {t('auth.code.sent', { email: state.email })}
        </Text>
        <OtpInput label={t('auth.code.label')} value={code} onChange={setCode} error={error} />
        <Button
          title={t('common.continue')}
          loading={busy}
          onPress={() =>
            isOtp(code)
              ? void run(() => auth.verify({ email: state.email, code }))
              : setError(t('auth.code.invalid'))
          }
        />
        <Button
          title={t('auth.code.resend')}
          variant="ghost"
          onPress={() => void run(() => auth.requestCode(state.email))}
        />
      </View>
    );
  }
  if (state.step === 'needsDetails') {
    return (
      <View>
        <Input
          label={t('auth.signup.birthDate')}
          hint={t('auth.signup.birthDate.hint')}
          placeholder="YYYY-MM-DD"
          value={birthDate}
          onChangeText={setBirthDate}
          error={error}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            minHeight: 44,
            marginBottom: space[4],
          }}
        >
          <Switch
            value={consent}
            onValueChange={setConsent}
            accessibilityLabel={t('auth.signup.consent', { version: noticeVersion ?? '—' })}
          />
          <Text style={{ color: colors.text, marginLeft: space[2], flex: 1 }}>
            {t('auth.signup.consent', { version: noticeVersion ?? '—' })}
          </Text>
        </View>
        <Button
          variant="ghost"
          title={t('auth.signup.readNotice')}
          onPress={() => setReadingNotice(true)}
        />
        <Sheet
          open={readingNotice}
          onClose={() => setReadingNotice(false)}
          title={t('settings.privacy.title')}
        >
          <ScrollView style={{ maxHeight: 480 }}>
            <PrivacyNoticeText version={noticeVersion} />
          </ScrollView>
        </Sheet>
        <Button
          title={t('auth.signup.submit')}
          loading={busy}
          onPress={() => {
            if (!isIsoDate(birthDate) || !isAdult(birthDate, new Date()))
              return setError(t('auth.signup.underage'));
            if (!noticeShown || !noticeVersion) return setError(t('privacy.notice.unavailable'));
            if (!consent) return setError(t('auth.signup.consent.required'));
            void run(() =>
              auth.verify({
                email: state.email,
                code: state.code,
                signup: { birthDate, consent: { noticeVersion, purposes: ['matching'] } },
              }),
            );
          }}
        />
      </View>
    );
  }
  return null;
}
