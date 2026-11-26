// @ts-check
import { relativeTime } from '@vouch/domain';
import { useConversations } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ListItem,
  Skeleton,
  Text,
  useTheme,
} from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { FlatList, View } from 'react-native';
import { CampusIllustration } from '../../shared/ui/Illustration.jsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.jsx';

/** The conversation list: last message, unread count, newest first. */
export function ChatsScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const list = useConversations();
  const top = <ScreenHeader title={t('chats.title')} />;
  if (list.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {top}
        <View style={{ padding: space[4] }}>
          <Skeleton height={64} />
        </View>
      </View>
    );
  }
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
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {top}
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: space[3], paddingTop: 0 }}
        data={list.conversations}
        keyExtractor={(c) => c.conversationId}
        ListEmptyComponent={
          <EmptyState
            art={<CampusIllustration width={280} />}
            title={t('chats.empty.title')}
            body={t('chats.empty.body')}
          />
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
              accessibilityLabel={[
                c.user.name,
                preview,
                last ? relativeTime(new Date(last.createdAt), now) : null,
                unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null,
              ]
                .filter(Boolean)
                .join(', ')}
              leading={
                <Avatar
                  uri={c.user.photos.at(0)?.w400 ?? null}
                  alt=""
                  name={c.user.name}
                  size={52}
                />
              }
              trailing={
                <View style={{ alignItems: 'flex-end', gap: space[1] }}>
                  {last ? (
                    <Text variant="caption" muted>
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
    </View>
  );
}
