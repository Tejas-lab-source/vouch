// @ts-check
import { useConversations } from '@vouch/features-core';
import { Avatar, Text, useTheme } from '@vouch/ui-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardSafetyActions } from '../../features/card-safety/CardSafetyActions.jsx';
import { clearConversationNotifications } from '../../shared/lib/push.js';
import { ConversationView } from '../../widgets/conversation/ConversationView.jsx';

/** `/chat/[id]`: the conversation, with report and block in the header. */
export function ChatScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id = '' } = useLocalSearchParams();
  const conversationId = String(id);
  const list = useConversations();
  const summary = list.conversations.find((c) => c.conversationId === conversationId) ?? null;
  // Opening a conversation clears its notifications.
  useEffect(() => {
    void clearConversationNotifications(conversationId);
  }, [conversationId]);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: summary?.user.name ?? '',
          headerStyle: { backgroundColor: colors.surface },
          headerTitle: () =>
            summary ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar
                  uri={summary.user.photos.at(0)?.w400 ?? null}
                  alt=""
                  name={summary.user.name}
                  size={36}
                />
                <Text variant="label" accessibilityRole="header">
                  {summary.user.name}
                </Text>
              </View>
            ) : null,
          headerRight: () =>
            summary ? (
              <CardSafetyActions
                compact
                user={summary.user}
                onBlocked={() => router.replace('/(tabs)/chats')}
              />
            ) : null,
        }}
      />
      <View style={{ flex: 1 }}>
        <ConversationView conversationId={conversationId} closed={summary?.closed ?? false} />
      </View>
    </SafeAreaView>
  );
}
