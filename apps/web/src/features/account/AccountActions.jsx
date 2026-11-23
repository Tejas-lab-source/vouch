// @ts-check
import { useAccountActions, useExportData } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Modal } from '@vouch/ui-web';
import { useState } from 'react';

/** Saves the export as a JSON file in the browser (nothing leaves the device). @param {unknown} data */
function download(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = `vouch-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Data export, log out, log out everywhere, and account deletion (typed confirmation). */
export function AccountActions() {
  const exporter = useExportData();
  const { signOut, signOutEverywhere, deleteAccount } = useAccountActions();
  const [dialog, setDialog] = useState(/** @type {null | 'all' | 'delete'} */ (null));
  const [typed, setTyped] = useState('');
  const close = () => {
    setDialog(null);
    setTyped('');
  };
  return (
    <div className="w-stack">
      <Button
        variant="secondary"
        loading={exporter.isPending}
        onClick={() => exporter.mutate(undefined, { onSuccess: download })}
      >
        {t('settings.export')}
      </Button>
      {exporter.isSuccess ? <p role="status">{t('settings.export.done')}</p> : null}
      <Button variant="secondary" loading={signOut.isPending} onClick={() => signOut.mutate()}>
        {t('settings.signOut')}
      </Button>
      <Button variant="secondary" onClick={() => setDialog('all')}>
        {t('settings.signOutAll')}
      </Button>
      <Button variant="danger" onClick={() => setDialog('delete')}>
        {t('settings.delete')}
      </Button>
      <Modal open={dialog === 'all'} onClose={close} title={t('settings.signOutAll')}>
        <p>{t('settings.signOutAll.body')}</p>
        {signOutEverywhere.isError ? (
          <p className="v-field__error" role="alert">
            {t('common.error')}
          </p>
        ) : null}
        <div className="w-row">
          <Button
            variant="danger"
            loading={signOutEverywhere.isPending}
            onClick={() => signOutEverywhere.mutate()}
          >
            {t('settings.signOutAll')}
          </Button>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
      <Modal open={dialog === 'delete'} onClose={close} title={t('settings.delete.title')}>
        <p>{t('settings.delete.body')}</p>
        <Input
          label={t('settings.delete.confirmLabel')}
          value={typed}
          autoComplete="off"
          onChange={(e) => setTyped(e.target.value)}
        />
        {deleteAccount.isError ? (
          <p className="v-field__error" role="alert">
            {t('common.error')}
          </p>
        ) : null}
        <div className="w-row">
          <Button
            variant="danger"
            disabled={typed.trim() !== t('settings.delete.confirmWord')}
            loading={deleteAccount.isPending}
            onClick={() => deleteAccount.mutate()}
          >
            {t('settings.delete.confirm')}
          </Button>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
