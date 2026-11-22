// @ts-check
import { isAdult, isEmail, isIsoDate, isOtp } from '@vouch/domain';
import { errorKey, useConfig, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, OtpInput } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Sign-in: college email → six-digit code → (first time) birth date and consent → signed in.
 * Validation runs on the client first (the same rules as the server), and server errors are
 * shown through i18n keys.
 */
export function SignInForm() {
  const { auth } = useServices();
  const config = useConfig();
  const [state, setState] = useState(/** @type {any} */ ({ step: 'signedOut' }));
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  const noticeVersion = config.data?.privacyNoticeVersion ?? 'draft';

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
      <form
        aria-label={t('auth.title')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isEmail(email)) return setError(t('auth.email.invalid'));
          void run(() => auth.requestCode(email.trim()));
        }}
      >
        <h2 className="w-title">{t('auth.title')}</h2>
        <Input
          label={t('auth.email.label')}
          type="email"
          autoComplete="email"
          placeholder={t('auth.email.placeholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error}
          required
          autoFocus
        />
        <Button type="submit" block loading={busy}>
          {t('common.continue')}
        </Button>
      </form>
    );
  }

  if (state.step === 'codeSent') {
    return (
      <form
        aria-label={t('auth.code.title')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isOtp(code)) return setError(t('auth.code.invalid'));
          void run(() => auth.verify({ email: state.email, code }));
        }}
      >
        <h2 className="w-title">{t('auth.code.title')}</h2>
        <p>{t('auth.code.sent', { email: state.email })}</p>
        <OtpInput
          label={t('auth.code.label')}
          value={code}
          onChange={setCode}
          error={error}
          autoFocus
        />
        <Button type="submit" block loading={busy}>
          {t('common.continue')}
        </Button>
        <Button variant="ghost" block onClick={() => void run(() => auth.requestCode(state.email))}>
          {t('auth.code.resend')}
        </Button>
      </form>
    );
  }

  if (state.step === 'needsDetails') {
    return (
      <form
        aria-label={t('auth.signup.title')}
        onSubmit={(event) => {
          event.preventDefault();
          if (!isIsoDate(birthDate) || !isAdult(birthDate, new Date())) {
            return setError(t('auth.signup.underage'));
          }
          if (!consent) return setError(t('auth.signup.consent.required'));
          void run(() =>
            auth.verify({
              email: state.email,
              code: state.code,
              signup: { birthDate, consent: { noticeVersion, purposes: ['matching'] } },
            }),
          );
        }}
      >
        <h2 className="w-title">{t('auth.signup.title')}</h2>
        <Input
          label={t('auth.signup.birthDate')}
          hint={t('auth.signup.birthDate.hint')}
          type="date"
          value={birthDate}
          onChange={(event) => setBirthDate(event.target.value)}
          required
        />
        <label className="w-check">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>{t('auth.signup.consent', { version: noticeVersion })}</span>
        </label>
        {error ? (
          <p className="v-field__error" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" block loading={busy}>
          {t('auth.signup.submit')}
        </Button>
      </form>
    );
  }
  return null;
}
