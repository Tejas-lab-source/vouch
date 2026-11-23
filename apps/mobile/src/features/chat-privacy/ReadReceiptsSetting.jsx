// @ts-check
import { useChatSettings, useUpdateChatSettings } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Skeleton, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { Switch, Text, View } from 'react-native';

/** "Share read receipts": off by default, reciprocal (ADR 0024). Saved as soon as it changes. */
export function ReadReceiptsSetting() {
  const { colors, minTouchTarget } = useTheme();
  const settings = useChatSettings();
  const save = useUpdateChatSettings();
  // The new value shows at once (and reverts if saving fails).
  const [pending, setPending] = useState(/** @type {boolean | null} */ (null));
  if (!settings.data) return <Skeleton height={44} />;
  const value = pending ?? settings.data.shareReadReceipts;
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: minTouchTarget,
        }}
      >
        <Text style={{ color: colors.text }}>{t('settings.readReceipts')}</Text>
        <Switch
          accessibilityLabel={t('settings.readReceipts')}
          accessibilityHint={t('settings.readReceipts.hint')}
          value={value}
          onValueChange={(v) => {
            setPending(v);
            save.mutate({ shareReadReceipts: v }, { onSettled: () => setPending(null) });
          }}
        />
      </View>
      <Text style={{ color: colors.textMuted }}>{t('settings.readReceipts.hint')}</Text>
    </View>
  );
}
