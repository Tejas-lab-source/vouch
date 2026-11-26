// @ts-check
import { Slot } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Ban,
  Bell,
  Card,
  ChevronRight,
  Icon,
  Lock,
  ShieldCheck,
  Text,
  UserRound,
  useTheme,
} from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { AccountActions } from '../../features/account/AccountActions.jsx';
import { BlockedUsers } from '../../features/blocked-users/BlockedUsers.jsx';
import { ReadReceiptsSetting } from '../../features/chat-privacy/ReadReceiptsSetting.jsx';
import { NotificationSettings } from '../../features/notification-settings/NotificationSettings.jsx';

/** A section title with its icon. @param {{ text: string, icon: any }} props */
function Heading({ text, icon }) {
  const { colors, space } = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] }}
    >
      <Icon icon={icon} color={colors.primaryText} />
      <Text variant="h2" style={{ fontSize: 18 }}>
        {text}
      </Text>
    </View>
  );
}

/** A row that opens another screen. @param {{ title: string, onPress: () => void }} props */
function LinkRow({ title, onPress }) {
  const { colors, space, radius, minTouchTarget } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: minTouchTarget,
        paddingHorizontal: space[2],
        borderRadius: radius.input,
        backgroundColor: pressed ? colors.secondary : 'transparent',
      })}
    >
      <Text variant="label">{title}</Text>
      <Icon icon={ChevronRight} size={20} color={colors.textMuted} />
    </Pressable>
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
        <Heading icon={Bell} text={t('settings.notifications.title')} />
        <NotificationSettings />
      </Card>
      <Card>
        <Heading icon={Lock} text={t('settings.privacy.chat.title')} />
        <ReadReceiptsSetting />
      </Card>
      <Card>
        <Heading icon={Ban} text={t('settings.blocked.title')} />
        <BlockedUsers />
      </Card>
      <Card>
        <Heading icon={ShieldCheck} text={t('settings.safety.title')} />
        <LinkRow
          title={t('settings.safety.title')}
          onPress={() => router.push('/settings/safety')}
        />
        <LinkRow
          title={t('settings.privacy.title')}
          onPress={() => router.push('/settings/privacy')}
        />
      </Card>
      <Slot name="settings.rows" render={(item) => <item.component />} />
      <Card>
        <Heading icon={UserRound} text={t('settings.account.title')} />
        <AccountActions />
      </Card>
    </ScrollView>
  );
}
