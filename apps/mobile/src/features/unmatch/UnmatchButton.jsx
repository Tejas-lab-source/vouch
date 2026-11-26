// @ts-check
import { useUnmatch } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Sheet, Text } from '@vouch/ui-native';
import { useState } from 'react';

/** Unmatch with a confirmation step. @param {{ match: import('@vouch/features-core').MatchSummary }} props */
export function UnmatchButton({ match }) {
  const [open, setOpen] = useState(false);
  const unmatch = useUnmatch();
  return (
    <>
      <Button variant="ghost" compact title={t('matches.unmatch')} onPress={() => setOpen(true)} />
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('matches.unmatch.title', { name: match.user.name })}
      >
        <Text>{t('matches.unmatch.body')}</Text>
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
