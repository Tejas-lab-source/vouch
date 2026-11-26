// @ts-check
import { useBlock, useReport } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Ban, Button, Flag, IconButton, Input, Sheet, Text, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { View } from 'react-native';
import { Choice } from '../../shared/ui/Choice.jsx';

const REASONS = /** @type {const} */ ([
  ['fake_profile', 'safety.reason.fakeProfile'],
  ['harassment', 'safety.reason.harassment'],
  ['inappropriate_content', 'safety.reason.inappropriateContent'],
  ['underage', 'safety.reason.underage'],
  ['spam', 'safety.reason.spam'],
  ['other', 'safety.reason.other'],
]);

/**
 * Report and Block for someone's card (Phase 10 APIs). Blocking is confirmed first and never
 * revealed to the other person.
 * `compact` shows icon buttons (the chat header); they keep the names "Report" and "Block".
 * @param {{ user: { userId: string, name: string }, onBlocked?: () => void, compact?: boolean }} props
 */
export function CardSafetyActions({ user, onBlocked, compact = false }) {
  const { colors, space } = useTheme();
  const [dialog, setDialog] = useState(/** @type {null | 'report' | 'block'} */ (null));
  const [reason, setReason] = useState(/** @type {(typeof REASONS)[number][0] | null} */ (null));
  const [note, setNote] = useState('');
  const report = useReport();
  const block = useBlock();
  const close = () => {
    setDialog(null);
    setReason(null);
    setNote('');
  };
  return (
    <View style={{ flexDirection: 'row', gap: space[1] }}>
      {compact ? (
        <>
          <IconButton icon={Flag} label={t('safety.report')} onPress={() => setDialog('report')} />
          <IconButton icon={Ban} label={t('safety.block')} onPress={() => setDialog('block')} />
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            compact
            icon={Flag}
            title={t('safety.report')}
            onPress={() => setDialog('report')}
          />
          <Button
            variant="ghost"
            compact
            icon={Ban}
            title={t('safety.block')}
            onPress={() => setDialog('block')}
          />
        </>
      )}
      <Sheet
        open={dialog === 'report'}
        onClose={close}
        title={t('safety.report.title', { name: user.name })}
      >
        {report.isSuccess ? (
          <Text accessibilityLiveRegion="polite" color={colors.successText}>
            {t('safety.report.sent')}
          </Text>
        ) : (
          <View>
            <Text variant="label" style={{ marginBottom: space[2] }}>
              {t('safety.report.reason')}
            </Text>
            {REASONS.map(([code, key]) => (
              <Choice
                key={code}
                wide
                label={t(key)}
                selected={reason === code}
                onPress={() => setReason(code)}
              />
            ))}
            <Input
              label={t('safety.report.note')}
              value={note}
              maxLength={500}
              multiline
              onChangeText={setNote}
            />
            <Button
              title={t('safety.report.submit')}
              disabled={!reason}
              loading={report.isPending}
              onPress={() =>
                reason &&
                report.mutate({
                  targetId: user.userId,
                  context: 'profile',
                  reason,
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              }
            />
          </View>
        )}
      </Sheet>
      <Sheet
        open={dialog === 'block'}
        onClose={close}
        title={t('safety.block.title', { name: user.name })}
      >
        <Text>{t('safety.block.body')}</Text>
        <Button
          variant="danger"
          title={t('safety.block.confirm')}
          loading={block.isPending}
          onPress={() =>
            block.mutate(user.userId, {
              onSuccess: () => {
                close();
                onBlocked?.();
              },
            })
          }
        />
      </Sheet>
    </View>
  );
}
