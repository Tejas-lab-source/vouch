// @ts-check
import { useLikesCount, useMatches } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Avatar,
  Button,
  ChevronRight,
  EmptyState,
  Heart,
  Icon,
  ListItem,
  Skeleton,
  Text,
  useTheme,
} from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { UnmatchButton } from '../../features/unmatch/UnmatchButton.jsx';
import { CampusIllustration } from '../../shared/ui/Illustration.jsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.jsx';

const NEW_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** Matches: new ones in a row, the full list (FlatList, paged), and the likes count. */
export function MatchesScreen() {
  const { colors, space, radius } = useTheme();
  const top = <ScreenHeader title={t('matches.title')} />;
  const router = useRouter();
  const list = useMatches();
  const likes = useLikesCount();
  const open = (/** @type {import('@vouch/features-core').MatchSummary} */ m) =>
    router.push(`/chat/${m.conversationId ?? m.matchId}`);
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
  const now = Date.now();
  const fresh = list.matches.filter((m) => now - Date.parse(m.createdAt) < NEW_FOR_MS).slice(0, 10);
  const header = (
    <View style={{ gap: space[3], marginBottom: space[3] }}>
      {likes.data ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[2],
            padding: space[3],
            borderRadius: radius.card,
            backgroundColor: colors.secondary,
          }}
        >
          <Icon icon={Heart} size={20} color={colors.primaryText} />
          <Text variant="label" color={colors.onSecondary}>
            {likes.data === 1 ? t('matches.likesOne') : t('matches.likes', { count: likes.data })}
          </Text>
        </View>
      ) : null}
      {fresh.length > 0 ? (
        <>
          <Text variant="h2">{t('matches.new')}</Text>
          <ScrollView horizontal contentContainerStyle={{ gap: space[3] }}>
            {fresh.map((m) => (
              <Pressable
                key={m.matchId}
                accessibilityRole="button"
                accessibilityLabel={t('matches.open', { name: m.user.name })}
                onPress={() => open(m)}
                style={{ alignItems: 'center', minWidth: 72, gap: space[1] }}
              >
                <View
                  style={{
                    padding: 3,
                    borderRadius: 40,
                    borderWidth: 2,
                    borderColor: colors.primary,
                  }}
                >
                  <Avatar
                    uri={m.user.photos.at(0)?.w400 ?? null}
                    alt=""
                    name={m.user.name}
                    size={64}
                  />
                </View>
                <Text variant="caption">{m.user.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text variant="h2">{t('matches.all')}</Text>
        </>
      ) : null}
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {top}
      <FlatList
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: space[4], paddingTop: space[2], gap: space[2] }}
        data={list.matches}
        keyExtractor={(m) => m.matchId}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            art={<CampusIllustration width={280} />}
            title={t('matches.empty.title')}
            body={t('matches.empty.body')}
          />
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              borderRadius: radius.card,
              borderWidth: 1,
              borderColor: colors.borderSubtle,
              backgroundColor: colors.surface,
            }}
          >
            <View style={{ flex: 1 }}>
              <ListItem
                title={item.user.name}
                subtitle={item.user.collegeName}
                leading={
                  <Avatar
                    uri={item.user.photos.at(0)?.w400 ?? null}
                    alt=""
                    name={item.user.name}
                    size={52}
                  />
                }
                trailing={<Icon icon={ChevronRight} size={20} color={colors.textMuted} />}
                onPress={() => open(item)}
              />
            </View>
            <UnmatchButton match={item} />
          </View>
        )}
      />
    </View>
  );
}
