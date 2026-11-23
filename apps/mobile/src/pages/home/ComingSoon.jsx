// @ts-check
import { t } from '@vouch/i18n';
import { EmptyState } from '@vouch/ui-native';

export function ComingSoon() {
  return <EmptyState title={t('home.empty.title')} body={t('home.empty.body')} />;
}
