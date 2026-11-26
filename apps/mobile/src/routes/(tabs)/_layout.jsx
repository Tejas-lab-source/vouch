// @ts-check
import { useOnboarding, useSession, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { font, Heart, MessageCircle, Skeleton, UserRound, Users, useTheme } from '@vouch/ui-native';
import { Redirect, Tabs } from 'expo-router';
import { NotificationTaps } from '../../app/NotificationTaps.jsx';
import { MatchMomentProvider } from '../../features/match-moment/MatchMoment.jsx';

/**
 * The signed-in tab bar, from the `home.tabs` slot (flag-filtered), once onboarding is done.
 * Routes stay thin: the match moment and screens come from features and pages.
 */
export default function TabsLayout() {
  const { signedIn } = useSession();
  if (!signedIn) return <Redirect href="/sign-in" />;
  return <OnboardedTabs />;
}

/** Tab icons (Lucide, 1.8 stroke): Discover, Matches, Chats, Profile. */
const TAB_ICONS = new Map([
  ['index', Heart],
  ['matches', Users],
  ['chats', MessageCircle],
  ['profile', UserRound],
]);

function OnboardedTabs() {
  const onboarding = useOnboarding();
  const tabs = useSlotItems('home.tabs');
  const { colors, icon, shadow } = useTheme();
  if (onboarding.isLoading || (!onboarding.step && !onboarding.isError))
    return <Skeleton height={32} />;
  if (onboarding.step && onboarding.step !== 'done') return <Redirect href="/onboarding" />;
  const visible = new Set(tabs.map((tab) => tab.id));
  return (
    <MatchMomentProvider>
      <NotificationTaps />
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: colors.primaryText,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.borderSubtle,
            height: 64,
            paddingTop: 6,
            ...shadow.card,
          },
          tabBarLabelStyle: { fontFamily: font('caption').fontFamily, fontSize: 12 },
          headerShown: false,
        }}
      >
        {['index', 'matches', 'chats', 'profile'].map((name) => {
          const tab = tabs.find((item) => item.id === name);
          const Glyph = TAB_ICONS.get(name) ?? Heart;
          return (
            <Tabs.Screen
              key={name}
              name={name}
              options={{
                title: tab ? t(/** @type {any} */ (tab.props?.labelKey)) : name,
                href: visible.has(name) ? undefined : null,
                tabBarIcon: ({ color }) => (
                  <Glyph size={24} color={color} strokeWidth={icon.strokeWidth} />
                ),
              }}
            />
          );
        })}
      </Tabs>
    </MatchMomentProvider>
  );
}
