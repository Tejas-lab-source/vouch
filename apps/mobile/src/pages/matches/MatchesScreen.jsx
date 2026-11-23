// @ts-check
import { useLikesCount, useMatches } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, EmptyState, ListItem, Skeleton, useTheme } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { UnmatchButton } from '../../features/unmatch/UnmatchButton.jsx';

const NEW_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** Matches: new ones in a row, the full list (FlatList, paged), and the likes count. */
export function MatchesScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const list = useMatches();
  const likes = useLikesCount();
  const open = (/** @type {import('@vouch/features-core').MatchSummary} */ m) =>
    router.push(`/chat/${m.conversationId ?? m.matchId}`);
  if (list.isLoading) return <Skeleton height={64} />;
  if (list.isError) {
    return (
      <EmptyState
        title={t('common.error')}
        action={<Button title={t('common.retry')} onPress={() => void list.refetch()} />}
      />
    );
  }
  const now = Date.now();
  const fresh = list.matches.filter((m) => now - Date.parse(m.createdAt) < NEW_FOR_MS).slice(0, 10);
  const header = (
    <View style={{ gap: space[3], marginBottom: space[3] }}>
      {likes.data ? (
        <Text style={{ color: colors.text }}>
          {likes.data === 1 ? t('matches.likesOne') : t('matches.likes', { count: likes.data })}
        </Text>
      ) : null}
      {fresh.length > 0 ? (
        <>
          <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>
            {t('matches.new')}
          </Text>
          <ScrollView horizontal contentContainerStyle={{ gap: space[3] }}>
            {fresh.map((m) => (
              <Pressable
                key={m.matchId}
                accessibilityRole="button"
                accessibilityLabel={t('matches.open', { name: m.user.name })}
                onPress={() => open(m)}
                style={{ alignItems: 'center', minWidth: 64 }}
              >
                <Avatar
                  uri={m.user.photos.at(0)?.w400 ?? null}
                  alt=""
                  name={m.user.name}
                  size={64}
                />
                <Text style={{ color: colors.text }}>{m.user.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>
            {t('matches.all')}
          </Text>
        </>
      ) : null}
    </View>
  );
  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4] }}
      data={list.matches}
      keyExtractor={(m) => m.matchId}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <EmptyState title={t('matches.empty.title')} body={t('matches.empty.body')} />
      }
      onEndReached={() => {
        if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      renderItem={({ item }) => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <ListItem
              title={item.user.name}
              subtitle={item.user.collegeName}
              leading={
                <Avatar uri={item.user.photos.at(0)?.w400 ?? null} alt="" name={item.user.name} />
              }
              onPress={() => open(item)}
            />
          </View>
          <UnmatchButton match={item} />
        </View>
      )}
    />
  );
}
