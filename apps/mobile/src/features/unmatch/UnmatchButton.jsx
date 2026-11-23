// @ts-check
import { useUnmatch } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Sheet, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { Text } from 'react-native';

/** Unmatch with a confirmation step. @param {{ match: import('@vouch/features-core').MatchSummary }} props */
export function UnmatchButton({ match }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const unmatch = useUnmatch();
  return (
    <>
      <Button variant="ghost" title={t('matches.unmatch')} onPress={() => setOpen(true)} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('matches.unmatch.title', { name: match.user.name })}
      >
        <Text style={{ color: colors.text }}>{t('matches.unmatch.body')}</Text>
        <Button
          variant="danger"
          title={t('matches.unmatch.confirm')}
          loading={unmatch.isPending}
          onPress={() => unmatch.mutate(match.matchId, { onSuccess: () => setOpen(false) })}
        />
      </Sheet>
    </>
  );
}
