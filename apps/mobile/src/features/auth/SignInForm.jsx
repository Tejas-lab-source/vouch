// @ts-check
import { isAdult, isEmail, isIsoDate, isOtp } from '@vouch/domain';
import { errorKey, useConfig, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { privacyNotice } from '@vouch/i18n/privacy-notice';
import {
  Button,
  Icon,
  Input,
  Lock,
  Mail,
  OtpInput,
  Sheet,
  ShieldCheck,
  Text,
  useTheme,
} from '@vouch/ui-native';
import { useState } from 'react';
import { SWITCH_WEB } from '../../shared/ui/switch-colors.js';
import { ScrollView, Switch, View } from 'react-native';
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
  const [inviteCode, setInviteCode] = useState('');
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
        <StepHead icon={Mail} title={t('auth.title')} />
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
        <Text variant="caption" muted style={{ textAlign: 'center', marginTop: space[3] }}>
          {t('auth.welcome.terms')}
        </Text>
      </View>
    );
  }
  if (state.step === 'codeSent') {
    return (
      <View>
        <StepHead
          icon={ShieldCheck}
          title={t('auth.code.title')}
          body={t('auth.code.sent', { email: state.email })}
        />
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
        <StepHead icon={Lock} title={t('auth.signup.title')} />
        <Input
          label={t('auth.signup.birthDate')}
          hint={t('auth.signup.birthDate.hint')}
          placeholder="YYYY-MM-DD"
          value={birthDate}
          onChangeText={setBirthDate}
          error={error}
        />
        <Input
          label={t('auth.signup.invite')}
          hint={t('auth.signup.invite.hint')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          value={inviteCode}
          onChangeText={setInviteCode}
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
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.onPrimary}
            {...SWITCH_WEB(colors)}
            accessibilityLabel={t('auth.signup.consent', { version: noticeVersion ?? '—' })}
          />
          <Text style={{ marginLeft: space[3], flex: 1 }}>
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
                signup: {
                  birthDate,
                  consent: { noticeVersion, purposes: ['matching'] },
                  ...(inviteCode.trim() ? { inviteCode: inviteCode.trim() } : {}),
                },
              }),
            );
          }}
        />
      </View>
    );
  }
  return null;
}

/** The round pink badge and heading above each step. @param {{ icon: any, title: string, body?: string }} props */
function StepHead({ icon, title, body }) {
  const { colors, space } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space[2], marginBottom: space[5] }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.secondary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon icon={icon} size={28} color={colors.primaryText} />
      </View>
      <Text variant="h2" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text muted style={{ textAlign: 'center' }}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}
