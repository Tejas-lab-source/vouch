// @ts-check
import { useChatSettings, useUpdateChatSettings } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Skeleton } from '@vouch/ui-web';
import { useId, useState } from 'react';

/** "Share read receipts": off by default, reciprocal (ADR 0024). Saved as soon as it changes. */
export function ReadReceiptsSetting() {
  const settings = useChatSettings();
  const save = useUpdateChatSettings();
  const hint = useId();
  // The new value shows at once (and reverts if saving fails).
  const [pending, setPending] = useState(/** @type {boolean | null} */ (null));
  if (!settings.data) return <Skeleton height={44} />;
  const checked = pending ?? settings.data.shareReadReceipts;
  return (
    <div>
      <label className="w-check">
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hint}
          onChange={(e) => {
            const next = e.target.checked;
            setPending(next);
            save.mutate({ shareReadReceipts: next }, { onSettled: () => setPending(null) });
          }}
        />
        {t('settings.readReceipts')}
      </label>
      <p id={hint} className="v-field__hint">
        {t('settings.readReceipts.hint')}
      </p>
      {save.isError ? (
        <p className="v-field__error" role="alert">
          {t('common.error')}
        </p>
      ) : null}
    </div>
  );
}
