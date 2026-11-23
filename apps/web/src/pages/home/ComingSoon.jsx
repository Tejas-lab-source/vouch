// @ts-check
import { t } from '@vouch/i18n';
import { EmptyState } from '@vouch/ui-web';

/** A placeholder tab (Phase 11): the real screens arrive in Phases 12–13. */
export function ComingSoon() {
  return <EmptyState title={t('home.empty.title')} body={t('home.empty.body')} />;
}
