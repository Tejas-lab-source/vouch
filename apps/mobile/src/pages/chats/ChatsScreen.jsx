// @ts-check
import { relativeTime } from '@vouch/domain';
import { useConversations } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Badge, Button, EmptyState, ListItem, Skeleton, useTheme } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { FlatList, Text, View } from 'react-native';

/** The conversation list: last message, unread count, newest first. */
export function ChatsScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const list = useConversations();
  if (list.isLoading) return <Skeleton height={64} />;
  if (list.isError) {
    return (
      <EmptyState
        title={t('common.error')}
        action={<Button title={t('common.retry')} onPress={() => void list.refetch()} />}
      />
    );
  }
  const now = new Date();
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
      data={list.conversations}
      keyExtractor={(c) => c.conversationId}
      ListEmptyComponent={
        <EmptyState title={t('chats.empty.title')} body={t('chats.empty.body')} />
      }
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      renderItem={({ item: c }) => {
        const unread = list.unread(c);
        const last = c.lastMessage;
        const preview = !last
          ? t('chats.noMessages')
          : last.senderId === list.me
            ? t('chats.you', { body: last.body })
            : last.body;
        return (
          <ListItem
            title={c.user.name}
            subtitle={preview}
            leading={<Avatar uri={c.user.photos.at(0)?.w400 ?? null} alt="" name={c.user.name} />}
            trailing={
              <View style={{ alignItems: 'flex-end', gap: space[1] }}>
                {last ? (
                  <Text style={{ color: colors.textMuted }}>
                    {relativeTime(new Date(last.createdAt), now)}
                  </Text>
                ) : null}
                {unread > 0 ? (
                  <Badge tone="accent" label={t('chats.unread', { count: unread })}>
                    {unread > 99 ? '99+' : String(unread)}
                  </Badge>
                ) : null}
              </View>
            }
            onPress={() => router.push(`/chat/${c.conversationId}`)}
          />
        );
      }}
    />
  );
}
