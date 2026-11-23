// @ts-check
import { t } from '@vouch/i18n';
import { Link } from 'react-router';

/** Safety tips and how to report (copy reviewed with the owner before launch). */
export function SafetyCentrePage() {
  return (
    <div className="w-page">
      <Link to="/settings">← {t('settings.title')}</Link>
      <h1 className="w-title">{t('safety.tips.title')}</h1>
      <ul>
        <li>{t('safety.tips.one')}</li>
        <li>{t('safety.tips.two')}</li>
        <li>{t('safety.tips.three')}</li>
        <li>{t('safety.tips.four')}</li>
      </ul>
      <h2 className="w-subtitle">{t('safety.howToReport.title')}</h2>
      <p>{t('safety.howToReport.body')}</p>
    </div>
  );
}
