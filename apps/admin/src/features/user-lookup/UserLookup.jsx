// @ts-check
import { adminCreateBan, adminGetUser, adminListAuditLog, ApiError } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button, Card, Input } from '@vouch/ui-web';
import { useState } from 'react';
import { describeAudit } from '../../entities/audit-entry/describe.js';

/**
 * Finds a user by public id and shows the staff view (no personal data beyond what moderation
 * needs). Admins can ban from here; the ban is confirmed and its audit entry shown.
 * @param {{ client: import('@vouch/api-client').ApiClient, role: 'moderator' | 'admin' }} props
 */
export function UserLookup({ client, role }) {
  const [id, setId] = useState('');
  const [user, setUser] = useState(/** @type {any} */ (null));
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [reason, setReason] = useState('');
  const [ends, setEnds] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [audit, setAudit] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);

  async function find() {
    setError(null);
    setAudit(null);
    try {
      setUser(await adminGetUser(client, { params: { userId: id.trim() } }));
    } catch (failure) {
      setUser(null);
      setError(
        failure instanceof ApiError && failure.status === 404
          ? t('admin.users.notFound')
          : t('common.error'),
      );
    }
  }

  async function ban() {
    setBusy(true);
    try {
      await adminCreateBan(client, {
        body: {
          userId: user.userId,
          reason: reason.trim(),
          ...(ends ? { expiresAt: new Date(ends).toISOString() } : {}),
        },
      });
      const log = await adminListAuditLog(client, { query: { limit: 1, targetId: user.userId } });
      setAudit(log.items.at(0) ? describeAudit(/** @type {any} */ (log.items.at(0))) : null);
      setConfirming(false);
      await find();
    } catch (failure) {
      setError(
        t('admin.action.failed', { code: failure instanceof ApiError ? failure.code : 'INTERNAL' }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="lookup-title">
      <h1 id="lookup-title">{t('admin.users.title')}</h1>
      <form
        className="a-row"
        onSubmit={(event) => {
          event.preventDefault();
          void find();
        }}
      >
        <Input
          label={t('admin.users.id')}
          value={id}
          onChange={(e) => setId(e.target.value)}
          autoComplete="off"
        />
        <Button type="submit" disabled={!id.trim()}>
          {t('admin.users.find')}
        </Button>
      </form>
      {error ? (
        <p className="v-field__error" role="alert">
          {error}
        </p>
      ) : null}
      {audit ? (
        <p role="status" className="a-audit">
          {t('admin.action.done')} {audit}
        </p>
      ) : null}
      {user ? (
        <Card as="article" aria-label={user.userId}>
          <p>
            <code>{user.userId}</code> · {user.collegeName}
          </p>
          <p>{t('admin.users.status', { status: user.status })}</p>
          <p>{t('admin.users.profile', { status: user.profileStatus ?? '—' })}</p>
          <p>{t('admin.users.reports', { count: user.reportsReceived })}</p>
          {user.activeBan ? (
            <p>
              {user.activeBan.expiresAt
                ? t('admin.users.banned', {
                    until: new Date(user.activeBan.expiresAt).toLocaleString(),
                  })
                : t('admin.users.bannedForever')}
            </p>
          ) : null}
          {role === 'admin' && !user.activeBan ? (
            confirming ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void ban();
                }}
              >
                <p>{t('admin.action.confirmBody')}</p>
                <Input
                  label={t('admin.users.banReason')}
                  value={reason}
                  required
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Input
                  label={t('admin.users.banEnds')}
                  type="datetime-local"
                  value={ends}
                  onChange={(e) => setEnds(e.target.value)}
                />
                <div className="a-row">
                  <Button type="submit" variant="danger" loading={busy} disabled={!reason.trim()}>
                    {t('admin.action.run')}
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                {t('admin.users.ban')}
              </Button>
            )
          ) : null}
        </Card>
      ) : null}
    </section>
  );
}
