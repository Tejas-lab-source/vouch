// @ts-check
import { useAccountActions, useExportData } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Input, Sheet, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { Share, Text, View } from 'react-native';

/** Export (shared through the system share sheet), log out, log out everywhere, delete. */
export function AccountActions() {
  const { colors, space } = useTheme();
  const exporter = useExportData();
  const { signOut, signOutEverywhere, deleteAccount } = useAccountActions();
  const [dialog, setDialog] = useState(/** @type {null | 'all' | 'delete'} */ (null));
  const [typed, setTyped] = useState('');
  const close = () => {
    setDialog(null);
    setTyped('');
  };
  return (
    <View style={{ gap: space[2] }}>
      <Button
        variant="secondary"
        title={t('settings.export')}
        loading={exporter.isPending}
        onPress={() =>
          exporter.mutate(undefined, {
            onSuccess: (data) => void Share.share({ message: JSON.stringify(data, null, 2) }),
          })
        }
      />
      <Button
        variant="secondary"
        title={t('settings.signOut')}
        loading={signOut.isPending}
        onPress={() => signOut.mutate()}
      />
      <Button
        variant="secondary"
        title={t('settings.signOutAll')}
        onPress={() => setDialog('all')}
      />
      <Button variant="danger" title={t('settings.delete')} onPress={() => setDialog('delete')} />
      <Sheet open={dialog === 'all'} onClose={close} title={t('settings.signOutAll')}>
        <Text style={{ color: colors.text }}>{t('settings.signOutAll.body')}</Text>
        <Button
          variant="danger"
          title={t('settings.signOutAll')}
          loading={signOutEverywhere.isPending}
          onPress={() => signOutEverywhere.mutate()}
        />
      </Sheet>
      <Sheet open={dialog === 'delete'} onClose={close} title={t('settings.delete.title')}>
        <Text style={{ color: colors.text }}>{t('settings.delete.body')}</Text>
        <Input
          label={t('settings.delete.confirmLabel')}
          value={typed}
          autoCapitalize="characters"
          onChangeText={setTyped}
        />
        <Button
          variant="danger"
          title={t('settings.delete.confirm')}
          disabled={typed.trim() !== t('settings.delete.confirmWord')}
          loading={deleteAccount.isPending}
          onPress={() => deleteAccount.mutate()}
        />
      </Sheet>
    </View>
  );
}
