// @ts-check
import { t } from '@vouch/i18n';
import { EmptyState, Illustration } from '@vouch/ui-web';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="w-page">
      <EmptyState
        art={<Illustration name="campus" className="w-empty-art" />}
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <Link className="v-button v-button--secondary" to="/">
            {t('notFound.home')}
          </Link>
        }
      />
    </main>
  );
}
