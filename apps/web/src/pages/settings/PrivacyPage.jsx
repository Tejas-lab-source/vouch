// @ts-check
import { useConfig } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Link } from 'react-router';
import { PrivacyNoticeText } from '../../entities/privacy-notice/PrivacyNoticeText.jsx';
import { GRIEVANCE_EMAIL } from '../../shared/config/index.js';

/**
 * The privacy notice in full (the version the server names) and the grievance contact. Public:
 * it is also linked from sign-up, before an account exists (Phase 14, DPDP).
 * @param {{ backTo?: string }} props
 */
export function PrivacyPage({ backTo = '/settings' }) {
  const config = useConfig();
  return (
    <div className="w-page">
      <Link to={backTo}>← {t(backTo === '/settings' ? 'settings.title' : 'common.back')}</Link>
      <h1 className="w-title">{t('settings.privacy.title')}</h1>
      <p>{t('privacy.summary')}</p>
      <PrivacyNoticeText version={config.data?.privacyNoticeVersion} />
      <h2 className="w-subtitle">{t('privacy.grievance.title')}</h2>
      <p>{t('privacy.grievance.body', { email: GRIEVANCE_EMAIL })}</p>
    </div>
  );
}
