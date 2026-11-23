// @ts-check
import {
  minutesToTime,
  timeToMinutes,
  useNotificationPrefs,
  useUpdateNotificationPrefs,
} from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Skeleton } from '@vouch/ui-web';
import { useEffect, useState } from 'react';

/** This browser's IANA time zone. */
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** Push preferences and quiet hours (in the user's time zone). */
export function NotificationSettings() {
  const prefs = useNotificationPrefs();
  const save = useUpdateNotificationPrefs();
  const [draft, setDraft] = useState(
    /** @type {import('@vouch/features-core').NotificationPrefs | null} */ (null),
  );
  const [quiet, setQuiet] = useState({ on: false, start: '22:00', end: '07:00' });

  useEffect(() => {
    if (!prefs.data || draft) return;
    setDraft(prefs.data);
    setQuiet(
      prefs.data.quietHours
        ? {
            on: true,
            start: minutesToTime(prefs.data.quietHours.startMinute),
            end: minutesToTime(prefs.data.quietHours.endMinute),
          }
        : { on: false, start: '22:00', end: '07:00' },
    );
  }, [prefs.data, draft]);

  if (!draft) return <Skeleton height={120} />;
  const start = timeToMinutes(quiet.start);
  const end = timeToMinutes(quiet.end);
  const valid = !quiet.on || (start !== null && end !== null);
  /** @param {'pushMatches' | 'pushMessages' | 'pushLikesDigest'} key @param {import('@vouch/i18n').MessageKey} label */
  const toggle = (key, label) => (
    <label className="w-check">
      <input
        type="checkbox"
        checked={new Map(Object.entries(draft)).get(key) === true}
        onChange={(e) =>
          setDraft(Object.assign({}, draft, Object.fromEntries([[key, e.target.checked]])))
        }
      />
      {t(label)}
    </label>
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        save.mutate({
          ...draft,
          quietHours: quiet.on
            ? { startMinute: /** @type {number} */ (start), endMinute: /** @type {number} */ (end) }
            : null,
          timezone:
            draft.timezone === 'UTC' && !prefs.data?.quietHours ? localZone() : draft.timezone,
        });
      }}
    >
      {toggle('pushMatches', 'settings.notifications.matches')}
      {toggle('pushMessages', 'settings.notifications.messages')}
      {toggle('pushLikesDigest', 'settings.notifications.likes')}
      <label className="w-check">
        <input
          type="checkbox"
          checked={quiet.on}
          onChange={(e) => setQuiet({ ...quiet, on: e.target.checked })}
        />
        {t('settings.quiet.enable')}
      </label>
      <p className="v-field__hint">{t('settings.quiet.hint')}</p>
      {quiet.on ? (
        <div className="w-row">
          <Input
            label={t('settings.quiet.start')}
            type="time"
            value={quiet.start}
            onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
          />
          <Input
            label={t('settings.quiet.end')}
            type="time"
            value={quiet.end}
            onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
          />
        </div>
      ) : null}
      <Input
        label={t('settings.timezone')}
        value={draft.timezone}
        maxLength={64}
        onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
      />
      {save.isError ? (
        <p className="v-field__error" role="alert">
          {t('common.error')}
        </p>
      ) : null}
      {save.isSuccess ? <p role="status">{t('settings.saved')}</p> : null}
      <Button type="submit" loading={save.isPending} disabled={!valid}>
        {t('profile.save')}
      </Button>
    </form>
  );
}
