// @ts-check
import { t } from '@vouch/i18n';
import { SignInForm } from '../../features/auth/SignInForm.jsx';

export function SignInPage() {
  return (
    <main className="w-page w-page--narrow">
      <h1 className="w-brand">{t('app.name')}</h1>
      <p className="w-tagline">{t('app.tagline')}</p>
      <SignInForm />
    </main>
  );
}
