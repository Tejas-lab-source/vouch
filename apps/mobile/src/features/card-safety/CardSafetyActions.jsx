// @ts-check
import { useBlock, useReport } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Sheet, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';
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
 * @param {{ user: { userId: string, name: string }, onBlocked?: () => void }} props
 */
export function CardSafetyActions({ user, onBlocked }) {
  const { colors } = useTheme();
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
    <View style={{ flexDirection: 'row' }}>
      <Button variant="ghost" title={t('safety.report')} onPress={() => setDialog('report')} />
      <Button variant="ghost" title={t('safety.block')} onPress={() => setDialog('block')} />
      <Sheet
        open={dialog === 'report'}
        onClose={close}
        title={t('safety.report.title', { name: user.name })}
      >
        {report.isSuccess ? (
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            {t('safety.report.sent')}
          </Text>
        ) : (
          <View>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {t('safety.report.reason')}
            </Text>
            {REASONS.map(([code, key]) => (
              <Choice
                key={code}
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
        <Text style={{ color: colors.text }}>{t('safety.block.body')}</Text>
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
