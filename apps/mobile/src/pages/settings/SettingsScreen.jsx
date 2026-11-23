// @ts-check
import { Slot } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Card, useTheme } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { AccountActions } from '../../features/account/AccountActions.jsx';
import { BlockedUsers } from '../../features/blocked-users/BlockedUsers.jsx';
import { ReadReceiptsSetting } from '../../features/chat-privacy/ReadReceiptsSetting.jsx';
import { NotificationSettings } from '../../features/notification-settings/NotificationSettings.jsx';

/** @param {{ text: string }} props */
function Heading({ text }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{ color: colors.text, fontWeight: '700', fontSize: 18, marginBottom: 8 }}
    >
      {text}
    </Text>
  );
}

/** Settings: notifications, blocked people, safety and privacy, account and data. */
export function SettingsScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4], gap: space[4] }}
    >
      <Card>
        <Heading text={t('settings.notifications.title')} />
        <NotificationSettings />
      </Card>
      <Card>
        <Heading text={t('settings.privacy.chat.title')} />
        <ReadReceiptsSetting />
      </Card>
      <Card>
        <Heading text={t('settings.blocked.title')} />
        <BlockedUsers />
      </Card>
      <Card>
        <Heading text={t('settings.safety.title')} />
        <Button
          variant="ghost"
          title={t('settings.safety.title')}
          onPress={() => router.push('/settings/safety')}
        />
        <Button
          variant="ghost"
          title={t('settings.privacy.title')}
          onPress={() => router.push('/settings/privacy')}
        />
      </Card>
      <Slot name="settings.rows" render={(item) => <item.component />} />
      <Card>
        <Heading text={t('settings.account.title')} />
        <AccountActions />
      </Card>
    </ScrollView>
  );
}
