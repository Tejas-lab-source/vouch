// @ts-check
import { useChatSettings, useUpdateChatSettings } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Skeleton, Text, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { SWITCH_WEB } from '../../shared/ui/switch-colors.js';
import { Switch, View } from 'react-native';

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
        <Text style={{ flex: 1 }}>{t('settings.readReceipts')}</Text>
        <Switch
          accessibilityLabel={t('settings.readReceipts')}
          accessibilityHint={t('settings.readReceipts.hint')}
          value={value}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.onPrimary}
          {...SWITCH_WEB(colors)}
          onValueChange={(v) => {
            setPending(v);
            save.mutate({ shareReadReceipts: v }, { onSettled: () => setPending(null) });
          }}
        />
      </View>
      <Text variant="caption" muted>
        {t('settings.readReceipts.hint')}
      </Text>
    </View>
  );
}
