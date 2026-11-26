// @ts-check
import { useBlockedUsers, useUnblock } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Skeleton, Text, useTheme } from '@vouch/ui-native';
import { View } from 'react-native';

/** The people I blocked, with Unblock. */
export function BlockedUsers() {
  const { space } = useTheme();
  const blocked = useBlockedUsers();
  const unblock = useUnblock();
  if (blocked.isLoading) return <Skeleton height={48} />;
  const items = blocked.data ?? [];
  return (
    <View>
      <Text variant="caption" muted style={{ marginBottom: space[2] }}>
        {t('settings.blocked.hint')}
      </Text>
      {items.length === 0 ? <Text>{t('settings.blocked.empty')}</Text> : null}
      {items.map((b) => {
        const name = b.name ?? t('settings.blocked.unknown');
        return (
          <View
            key={b.userId}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text variant="label">{name}</Text>
            <Button
              variant="secondary"
              title={t('settings.blocked.unblock')}
              accessibilityLabel={t('settings.blocked.unblockNamed', { name })}
              onPress={() => unblock.mutate(b.userId)}
            />
          </View>
        );
      })}
    </View>
  );
}
