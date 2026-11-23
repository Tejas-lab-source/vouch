// @ts-check
import { adminPutFlag } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Turns a feature flag on or off, keeping its rules (confirmed first; audited by the server).
 * @param {{ client: import('@vouch/api-client').ApiClient, flag: { key: string, enabled: boolean, rules: unknown[] }, onDone: () => void }} props
 */
export function FlagToggle({ client, flag, onDone }) {
  const [busy, setBusy] = useState(false);
  const next = !flag.enabled;
  const state = next ? t('admin.flags.on') : t('admin.flags.off');
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        if (!globalThis.confirm(t('admin.flags.toggle', { key: flag.key, state }))) return;
        setBusy(true);
        try {
          await adminPutFlag(client, {
            params: { key: flag.key },
            body: { enabled: next, rules: /** @type {any} */ (flag.rules) },
          });
          onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      {t('admin.flags.toggle', { key: flag.key, state })}
    </Button>
  );
}
