// @ts-check
import { useSession, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { useTheme } from '@vouch/ui-native';
import { Redirect, Tabs } from 'expo-router';

/** The signed-in tab bar, from the `home.tabs` slot (flag-filtered). */
export default function TabsLayout() {
  const { signedIn } = useSession();
  const tabs = useSlotItems('home.tabs');
  const { colors } = useTheme();
  if (!signedIn) return <Redirect href="/sign-in" />;
  const visible = new Set(tabs.map((tab) => tab.id));
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface },
        headerShown: false,
      }}
    >
      {['index', 'matches', 'chats', 'profile'].map((name) => {
        const tab = tabs.find((item) => item.id === name);
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: tab ? t(/** @type {any} */ (tab.props?.labelKey)) : name,
              href: visible.has(name) ? undefined : null,
            }}
          />
        );
      })}
    </Tabs>
  );
}
