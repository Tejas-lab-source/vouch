// @ts-check
import { useUnmatch } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Modal } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Unmatch with a confirmation step (it cannot be undone).
 * @param {{ match: import('@vouch/features-core').MatchSummary }} props
 */
export function UnmatchButton({ match }) {
  const [open, setOpen] = useState(false);
  const unmatch = useUnmatch();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {t('matches.unmatch')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('matches.unmatch.title', { name: match.user.name })}
      >
        <p>{t('matches.unmatch.body')}</p>
        {unmatch.isError ? (
          <p className="v-field__error" role="alert">
            {t('common.error')}
          </p>
        ) : null}
        <div className="w-row">
          <Button
            variant="danger"
            loading={unmatch.isPending}
            onClick={() => unmatch.mutate(match.matchId, { onSuccess: () => setOpen(false) })}
          >
            {t('matches.unmatch.confirm')}
          </Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
