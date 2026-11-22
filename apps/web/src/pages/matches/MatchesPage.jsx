// @ts-check
import { useLikesCount, useMatches } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, EmptyState, ListItem, Skeleton } from '@vouch/ui-web';
import { useNavigate } from 'react-router';
import { UnmatchButton } from '../../features/unmatch/UnmatchButton.jsx';

/** Matches from the last 3 days that you have not opened yet appear in the "New" row. */
const NEW_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** @param {number} count */
const likesLine = (count) => (count === 1 ? t('matches.likesOne') : t('matches.likes', { count }));

/** The matches: a row of new ones, the full list (infinite), and the likes count. */
export function MatchesPage() {
  const list = useMatches();
  const likes = useLikesCount();
  const navigate = useNavigate();
  const open = (/** @type {import('@vouch/features-core').MatchSummary} */ m) =>
    navigate(`/chats/${m.conversationId ?? m.matchId}`);
  const now = Date.now();
  const fresh = list.matches.filter((m) => now - Date.parse(m.createdAt) < NEW_FOR_MS).slice(0, 10);

  return (
    <div className="w-page">
      <h1 className="w-title">{t('matches.title')}</h1>
      {likes.data ? <p className="w-likes">{likesLine(likes.data)}</p> : null}
      {list.isLoading ? (
        <div aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : null}
      {list.isError ? (
        <EmptyState
          title={t('common.error')}
          action={<Button onClick={() => void list.refetch()}>{t('common.retry')}</Button>}
        />
      ) : null}
      {list.isSuccess && list.matches.length === 0 ? (
        <EmptyState title={t('matches.empty.title')} body={t('matches.empty.body')} />
      ) : null}
      {fresh.length > 0 ? (
        <section aria-labelledby="new-matches">
          <h2 id="new-matches" className="w-subtitle">
            {t('matches.new')}
          </h2>
          <ul className="w-new-matches">
            {fresh.map((m) => (
              <li key={m.matchId}>
                <button
                  type="button"
                  className="w-new-match"
                  aria-label={t('matches.open', { name: m.user.name })}
                  onClick={() => open(m)}
                >
                  <Avatar
                    src={m.user.photos.at(0)?.w400 ?? null}
                    alt=""
                    name={m.user.name}
                    size={64}
                  />
                  <span aria-hidden="true">{m.user.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {list.matches.length > 0 ? (
        <section aria-labelledby="all-matches">
          <h2 id="all-matches" className="w-subtitle">
            {t('matches.all')}
          </h2>
          <ul className="w-list">
            {list.matches.map((m) => (
              <li key={m.matchId} className="w-list__row">
                <ListItem
                  title={m.user.name}
                  subtitle={m.user.collegeName}
                  leading={
                    <Avatar
                      src={m.user.photos.at(0)?.w400 ?? null}
                      alt=""
                      name={m.user.name}
                      size={48}
                    />
                  }
                  onClick={() => open(m)}
                />
                <UnmatchButton match={m} />
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t('matches.more')}
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
