// @ts-check
import { t } from '@vouch/i18n';
import { Button, Input, Wordmark } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Staff sign-in: email, password and the authenticator code. Every failure shows the same
 * message, like the server.
 * @param {{ onSignIn: (body: { email: string, password: string, totp: string }) => Promise<void> }} props
 */
export function LoginPage({ onSignIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);
  return (
    <main className="a-page">
      <div className="a-login">
        <Wordmark height={40} />
        <h1 className="a-login__title">{t('admin.title')}</h1>
        <form
          aria-label={t('admin.title')}
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await onSignIn({ email: email.trim(), password, totp });
            } catch {
              setError(t('admin.login.failed'));
              setTotp('');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            label={t('admin.login.email')}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label={t('admin.login.password')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label={t('admin.login.totp')}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
            error={error}
            required
          />
          <Button type="submit" block loading={busy}>
            {t('admin.login.submit')}
          </Button>
        </form>
      </div>
    </main>
  );
}
