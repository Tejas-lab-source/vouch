// @ts-check
import {
  minutesToTime,
  timeToMinutes,
  useNotificationPrefs,
  useServices,
  useUpdateNotificationPrefs,
} from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Skeleton, useTheme } from '@vouch/ui-native';
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

/** @param {{ label: string, value: boolean, onChange: (v: boolean) => void }} props */
function Row({ label, value, onChange }) {
  const { colors, minTouchTarget } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: minTouchTarget,
      }}
    >
      <Text style={{ color: colors.text }}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}

/** Push preferences and quiet hours (HH:MM in the device's time zone). */
export function NotificationSettings() {
  const { colors } = useTheme();
  const prefs = useNotificationPrefs();
  const save = useUpdateNotificationPrefs();
  const [draft, setDraft] = useState(
    /** @type {import('@vouch/features-core').NotificationPrefs | null} */ (null),
  );
  const [quiet, setQuiet] = useState({ on: false, start: '22:00', end: '07:00' });
  // If the system permission is off, say so: the switches alone would not bring pushes.
  const { push } = /** @type {any} */ (useServices());
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (push)
      void push
        .status()
        .then((/** @type {string} */ s) => setDenied(s === 'denied'))
        .catch(() => {});
  }, [push]);
  useEffect(() => {
    if (!prefs.data || draft) return;
    setDraft(prefs.data);
    if (prefs.data.quietHours) {
      setQuiet({
        on: true,
        start: minutesToTime(prefs.data.quietHours.startMinute),
        end: minutesToTime(prefs.data.quietHours.endMinute),
      });
    }
  }, [prefs.data, draft]);
  if (!draft) return <Skeleton height={120} />;
  const start = timeToMinutes(quiet.start);
  const end = timeToMinutes(quiet.end);
  const valid = !quiet.on || (start !== null && end !== null);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || draft.timezone;
  return (
    <View>
      {denied ? <Text style={{ color: colors.danger }}>{t('settings.pushDenied')}</Text> : null}
      <Row
        label={t('settings.notifications.matches')}
        value={draft.pushMatches}
        onChange={(v) => setDraft({ ...draft, pushMatches: v })}
      />
      <Row
        label={t('settings.notifications.messages')}
        value={draft.pushMessages}
        onChange={(v) => setDraft({ ...draft, pushMessages: v })}
      />
      <Row
        label={t('settings.notifications.likes')}
        value={draft.pushLikesDigest}
        onChange={(v) => setDraft({ ...draft, pushLikesDigest: v })}
      />
      <Row
        label={t('settings.quiet.enable')}
        value={quiet.on}
        onChange={(v) => setQuiet({ ...quiet, on: v })}
      />
      {quiet.on ? (
        <>
          <Input
            label={t('settings.quiet.start')}
            value={quiet.start}
            placeholder="22:00"
            onChangeText={(v) => setQuiet({ ...quiet, start: v })}
          />
          <Input
            label={t('settings.quiet.end')}
            value={quiet.end}
            placeholder="07:00"
            onChangeText={(v) => setQuiet({ ...quiet, end: v })}
          />
        </>
      ) : null}
      {save.isSuccess ? <Text accessibilityLiveRegion="polite">{t('settings.saved')}</Text> : null}
      <Button
        title={t('profile.save')}
        loading={save.isPending}
        disabled={!valid}
        onPress={() =>
          save.mutate({
            ...draft,
            quietHours: quiet.on
              ? {
                  startMinute: /** @type {number} */ (start),
                  endMinute: /** @type {number} */ (end),
                }
              : null,
            timezone: zone,
          })
        }
      />
    </View>
  );
}
