// @ts-check
import { useConfig } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Link } from 'react-router';
import { GRIEVANCE_EMAIL } from '../../shared/config/index.js';

/** The privacy notice summary and the grievance contact (full text in Phase 15). */
export function PrivacyPage() {
  const config = useConfig();
  return (
    <div className="w-page">
      <Link to="/settings">← {t('settings.title')}</Link>
      <h1 className="w-title">{t('settings.privacy.title')}</h1>
      <p>{t('privacy.summary')}</p>
      <p className="v-field__hint">
        {t('privacy.version', { version: config.data?.privacyNoticeVersion ?? 'draft' })}
      </p>
      <h2 className="w-subtitle">{t('privacy.grievance.title')}</h2>
      <p>{t('privacy.grievance.body', { email: GRIEVANCE_EMAIL })}</p>
    </div>
  );
}
