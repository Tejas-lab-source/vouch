// @ts-check
import { t } from '@vouch/i18n';
import { Illustration, Wordmark } from '@vouch/ui-web';
import { SignInForm } from '../../features/auth/SignInForm.jsx';

/** Sign-in: the brand panel (wordmark, motto, campus art) beside the form; stacked on phones. */
export function SignInPage() {
  return (
    <main className="w-auth">
      <section className="w-auth__brand" aria-labelledby="brand-title">
        <Illustration name="pattern" className="w-auth__pattern" width={120} height={120} />
        <h1 id="brand-title" className="w-auth__wordmark">
          <Wordmark height={64} />
        </h1>
        <p className="w-auth__motto">{t('brand.motto')}</p>
        <p className="w-auth__audience">{t('brand.audience')}</p>
        <Illustration name="campus" className="w-auth__art" />
      </section>
      <section className="w-auth__panel">
        <div className="w-auth__card">
          <SignInForm />
        </div>
      </section>
    </main>
  );
}
