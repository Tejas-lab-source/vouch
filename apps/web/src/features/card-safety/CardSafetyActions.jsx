// @ts-check
import { useBlock, useReport } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Ban, Button, Flag, Modal } from '@vouch/ui-web';
import { useId, useState } from 'react';

/** Report reasons (contracts `ReportReason`) and their labels. */
const REASONS = /** @type {const} */ ([
  ['fake_profile', 'safety.reason.fakeProfile'],
  ['harassment', 'safety.reason.harassment'],
  ['inappropriate_content', 'safety.reason.inappropriateContent'],
  ['underage', 'safety.reason.underage'],
  ['spam', 'safety.reason.spam'],
  ['other', 'safety.reason.other'],
]);

/**
 * Report and Block for someone's card. Blocking asks for confirmation and removes them from
 * the deck and matches at once; it is never revealed to them.
 * @param {{ user: { userId: string, name: string }, context?: 'profile' | 'chat', conversationId?: string, onBlocked?: () => void }} props
 */
export function CardSafetyActions({ user, context = 'profile', conversationId, onBlocked }) {
  const [dialog, setDialog] = useState(/** @type {null | 'report' | 'block'} */ (null));
  const [reason, setReason] = useState(/** @type {string | null} */ (null));
  const [note, setNote] = useState('');
  const report = useReport();
  const block = useBlock();
  const legend = useId();
  const noteId = useId();
  const close = () => {
    setDialog(null);
    setReason(null);
    setNote('');
  };
  return (
    <div className="w-row">
      <Button variant="ghost" icon={Flag} onClick={() => setDialog('report')}>
        {t('safety.report')}
      </Button>
      <Button variant="ghost" icon={Ban} onClick={() => setDialog('block')}>
        {t('safety.block')}
      </Button>
      <Modal
        open={dialog === 'report'}
        onClose={close}
        title={t('safety.report.title', { name: user.name })}
      >
        {report.isSuccess ? (
          <p role="status">{t('safety.report.sent')}</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason) return;
              report.mutate({
                targetId: user.userId,
                context,
                reason: /** @type {any} */ (reason),
                ...(conversationId ? { conversationId } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
              });
            }}
          >
            <fieldset className="w-fieldset" aria-labelledby={legend}>
              <legend id={legend} className="v-field__label">
                {t('safety.report.reason')}
              </legend>
              {REASONS.map(([code, key]) => (
                <label key={code} className="w-check">
                  <input
                    type="radio"
                    name="reason"
                    value={code}
                    checked={reason === code}
                    onChange={() => setReason(code)}
                  />
                  {t(key)}
                </label>
              ))}
            </fieldset>
            <div className="v-field">
              <label className="v-field__label" htmlFor={noteId}>
                {t('safety.report.note')}
              </label>
              <textarea
                id={noteId}
                className="v-input w-textarea"
                maxLength={500}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {report.isError ? (
              <p className="v-field__error" role="alert">
                {t('common.error')}
              </p>
            ) : null}
            <Button type="submit" block disabled={!reason} loading={report.isPending}>
              {t('safety.report.submit')}
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        open={dialog === 'block'}
        onClose={close}
        title={t('safety.block.title', { name: user.name })}
      >
        <p>{t('safety.block.body')}</p>
        {block.isError ? (
          <p className="v-field__error" role="alert">
            {t('common.error')}
          </p>
        ) : null}
        <div className="w-row">
          <Button
            variant="danger"
            loading={block.isPending}
            onClick={() =>
              block.mutate(user.userId, {
                onSuccess: () => {
                  close();
                  onBlocked?.();
                },
              })
            }
          >
            {t('safety.block.confirm')}
          </Button>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
