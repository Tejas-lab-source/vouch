// @ts-check
import { relativeTime } from '@vouch/domain';
import { useConversations } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Badge, Button, EmptyState, Illustration, ListItem, Skeleton } from '@vouch/ui-web';
import { useNavigate } from 'react-router';

/** The conversation list: last message, unread count, newest activity first. */
export function ChatsPage() {
  const list = useConversations();
  const navigate = useNavigate();
  const now = new Date();
  return (
    <div className="w-page">
      <h1 className="w-title">{t('chats.title')}</h1>
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
      {list.isSuccess && list.conversations.length === 0 ? (
        <EmptyState
          art={<Illustration name="campus" className="w-empty-art" />}
          title={t('chats.empty.title')}
          body={t('chats.empty.body')}
        />
      ) : null}
      <ul className="w-list">
        {list.conversations.map((c) => {
          const unread = list.unread(c);
          const last = c.lastMessage;
          const preview = !last
            ? t('chats.noMessages')
            : last.senderId === list.me
              ? t('chats.you', { body: last.body })
              : last.body;
          return (
            <li key={c.conversationId} className="w-list__row">
              <ListItem
                title={c.user.name}
                subtitle={preview}
                leading={
                  <Avatar
                    src={c.user.photos.at(0)?.w400 ?? null}
                    alt=""
                    name={c.user.name}
                    size={52}
                  />
                }
                trailing={
                  <span className="w-chats__meta">
                    {last ? <span>{relativeTime(new Date(last.createdAt), now)}</span> : null}
                    {unread > 0 ? (
                      <Badge tone="accent" label={t('chats.unread', { count: unread })}>
                        {unread > 99 ? '99+' : String(unread)}
                      </Badge>
                    ) : null}
                  </span>
                }
                onClick={() => navigate(`/chats/${c.conversationId}`)}
              />
            </li>
          );
        })}
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
    </div>
  );
}
