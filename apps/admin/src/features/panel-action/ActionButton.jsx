// @ts-check
import { adminListAuditLog, ApiError, ENDPOINTS } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button, Modal } from '@vouch/ui-web';
import { useId, useRef, useState } from 'react';
import { describeAudit } from '../../entities/audit-entry/describe.js';
import { getPath, pathParams, rowId } from '../../shared/lib/panels.js';

/**
 * @typedef {{ id: string, label: string, endpoint: string, body: Record<string, unknown>, needsNote: boolean, confirm: boolean, danger: boolean }} PanelAction
 * @typedef {import('../../entities/audit-entry/describe.js').AuditEntry} AuditEntry
 */

/**
 * One panel action. Every action asks for confirmation (with a note when the panel says so),
 * then shows the audit entry it created.
 * @param {{ client: import('@vouch/api-client').ApiClient, action: PanelAction, row: Record<string, unknown>, onDone: () => void }} props
 */
export function ActionButton({ client, action, row, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [audit, setAudit] = useState(/** @type {AuditEntry | null} */ (null));
  const noteId = useId();
  const endpoint = new Map(Object.entries(ENDPOINTS)).get(action.endpoint);
  const id = rowId(row);

  async function run() {
    if (!endpoint) return;
    setBusy(true);
    setError(null);
    try {
      /** @type {Record<string, string>} */
      const params = Object.fromEntries(
        pathParams(endpoint.path).map((name) => [
          name,
          String(name === 'id' ? id : getPath(row, name)),
        ]),
      );
      const body = { ...action.body, ...(action.needsNote ? { note: note.trim() } : {}) };
      await client.call(endpoint, {
        params,
        ...(endpoint.method === 'GET' ? {} : { body }),
      });
      // The entry this action wrote: the newest one about this item (or the newest of all).
      const mine = await adminListAuditLog(client, {
        query: { limit: 1, ...(id ? { targetId: id } : {}) },
      });
      const entry =
        mine.items.at(0) ?? (await adminListAuditLog(client, { query: { limit: 1 } })).items.at(0);
      setAudit(/** @type {AuditEntry | null} */ (entry ?? null));
      done.current = true;
    } catch (failure) {
      setError(
        t('admin.action.failed', { code: failure instanceof ApiError ? failure.code : 'INTERNAL' }),
      );
    } finally {
      setBusy(false);
    }
  }

  // The list refreshes when the dialog closes: refreshing at once could remove this row (and
  // the dialog showing the audit entry) as soon as the item leaves the queue.
  const done = useRef(false);
  const close = () => {
    if (done.current) {
      done.current = false;
      onDone();
    }
    setOpen(false);
    setNote('');
    setError(null);
    setAudit(null);
  };
  const needsNote = action.needsNote && note.trim().length === 0;
  return (
    <>
      <Button
        variant={action.danger ? 'danger' : 'secondary'}
        onClick={() => setOpen(true)}
        disabled={!endpoint || !id}
      >
        {action.label}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t('admin.action.confirmTitle', { action: action.label })}
      >
        {audit ? (
          <div role="status">
            <p>{t('admin.action.done')}</p>
            <p className="a-audit">{describeAudit(audit)}</p>
            <Button onClick={close}>{t('common.close')}</Button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!needsNote) void run();
            }}
          >
            <p>{t('admin.action.confirmBody')}</p>
            {action.needsNote ? (
              <div className="v-field">
                <label className="v-field__label" htmlFor={noteId}>
                  {t('admin.action.note')}
                </label>
                <textarea
                  id={noteId}
                  className="v-input"
                  rows={3}
                  maxLength={500}
                  required
                  aria-describedby={`${noteId}-hint`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <p id={`${noteId}-hint`} className="v-field__hint">
                  {t('admin.action.noteHint')}
                </p>
              </div>
            ) : null}
            {error ? (
              <p className="v-field__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="a-row">
              <Button
                type="submit"
                variant={action.danger ? 'danger' : 'primary'}
                loading={busy}
                disabled={needsNote}
              >
                {t('admin.action.run')}
              </Button>
              <Button variant="secondary" onClick={close}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
