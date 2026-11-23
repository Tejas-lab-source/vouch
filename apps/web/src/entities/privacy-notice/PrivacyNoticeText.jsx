// @ts-check
import { t } from '@vouch/i18n';
import { privacyNotice } from '@vouch/i18n/privacy-notice';

/**
 * The full privacy notice for a version (Phase 14). Null version text means this build does
 * not ship that version: the student is asked to update rather than agree to unseen text.
 * @param {{ version: string | null | undefined, headingLevel?: 2 | 3 }} props
 */
export function PrivacyNoticeText({ version, headingLevel = 2 }) {
  const notice = privacyNotice(version);
  if (!notice) {
    return (
      <p role="alert" className="v-field__error">
        {t('privacy.notice.unavailable')}
      </p>
    );
  }
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="w-notice" aria-label={t('settings.privacy.title')}>
      <p className="v-field__hint">
        {t('privacy.version', { version: notice.version })} ·{' '}
        {t('privacy.notice.effective', { date: notice.effectiveDate })}
        {notice.status === 'draft' ? ` · ${t('privacy.notice.draft')}` : ''}
      </p>
      {notice.sections.map((section) => (
        <section key={section.heading}>
          <Heading className="w-subtitle">{section.heading}</Heading>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
