// @ts-check
import { useMarkRead, useMessages, useSendMessage, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, EmptyState, Skeleton } from '@vouch/ui-web';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Link, useNavigate } from 'react-router';
import { MessageState } from '../../entities/message/MessageState.jsx';
import { TextMessage } from '../../entities/message/TextMessage.jsx';
import { CardSafetyActions } from '../../features/card-safety/CardSafetyActions.jsx';
import { Composer } from '../../features/composer/Composer.jsx';

/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const CLOSED = new Map([
  ['unmatched', 'chat.closed.unmatched'],
  ['blocked', 'chat.closed.blocked'],
  ['banned', 'chat.closed.banned'],
  ['deleted', 'chat.closed.deleted'],
]);
/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const SEND_ERRORS = new Map([
  ['RATE_LIMITED', 'chat.error.rateLimited'],
  ['LINKS_NOT_ALLOWED', 'chat.error.links'],
]);

/** Whether the page is visible (read receipts only while the user can see the messages). */
function usePageVisible() {
  return useSyncExternalStore(
    (onChange) => {
      globalThis.document.addEventListener('visibilitychange', onChange);
      return () => globalThis.document.removeEventListener('visibilitychange', onChange);
    },
    () => globalThis.document.visibilityState === 'visible',
    () => true,
  );
}

/** @param {string} iso */
function dayLabel(iso) {
  const day = iso.slice(0, 10);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (day === today.toISOString().slice(0, 10)) return t('chat.today');
  if (day === yesterday.toISOString().slice(0, 10)) return t('chat.yesterday');
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * @typedef {{ type: 'day', key: string, label: string }
 *   | { type: 'message', key: string, message: import('@vouch/features-core').Message, mine: boolean, state: string | null }
 *   | { type: 'outgoing', key: string, outgoing: { clientMsgId: string, body: string, state: string, error: string | null } }} Row
 */

/**
 * One conversation: the header (report and block), a virtualised message list (only the rows
 * on screen are in the DOM, so 1,000+ messages stay smooth), date separators, my messages'
 * states, the closed state and the composer.
 * @param {{ conversationId: string, user: { userId: string, name: string, photos: { w400: string }[] } | null, closed?: boolean }} props
 *   `closed`: from the conversation list (a reload); live closes arrive over the socket.
 */
export function ConversationView({ conversationId, user, closed = false }) {
  const navigate = useNavigate();
  const visible = usePageVisible();
  const chat = useMessages(conversationId);
  const { send, retry } = useSendMessage(conversationId);
  useMarkRead(conversationId, chat.messages, visible);
  const renderers = useSlotItems('chat.messageRenderers');
  const byKind = useMemo(
    () =>
      new Map(renderers.map((item) => [/** @type {string} */ (item.props?.kind), item.component])),
    [renderers],
  );

  /** @type {Row[]} */
  const rows = useMemo(() => {
    /** @type {Row[]} */
    const out = [];
    let lastDay = '';
    for (const m of chat.messages) {
      const day = m.createdAt.slice(0, 10);
      if (day !== lastDay) {
        out.push({ type: 'day', key: `day-${day}`, label: dayLabel(m.createdAt) });
        lastDay = day;
      }
      out.push({
        type: 'message',
        key: `m-${m.seq}`,
        message: m,
        mine: m.senderId === chat.me,
        state: chat.stateOf(m),
      });
    }
    for (const o of chat.outgoing)
      out.push({ type: 'outgoing', key: `o-${o.clientMsgId}`, outgoing: o });
    return out;
  }, [chat]);

  const scroller = useRef(/** @type {HTMLDivElement | null} */ (null));
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 56,
    overscan: 8,
    getItemKey: (index) => rows.at(index)?.key ?? index,
  });

  // Stay at the newest message when one arrives (unless the user scrolled up to read).
  const atBottom = useRef(true);
  const last = rows.at(-1)?.key;
  useEffect(() => {
    if (rows.length > 0 && atBottom.current)
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [last, rows.length, virtualizer]);

  if (chat.isLoading) {
    return (
      <div aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }
  if (chat.isError) {
    return (
      <EmptyState title={t('chat.notFound')} action={<Link to="/chats">{t('chat.back')}</Link>} />
    );
  }
  const closedKey = chat.closed ? CLOSED.get(chat.closed) : closed ? CLOSED.get('unmatched') : null;
  const name = user?.name ?? '';
  return (
    <section className="w-chat" aria-label={t('chat.messages', { name })}>
      <header className="w-chat__header">
        <Link to="/chats" className="w-chat__back" aria-label={t('chat.back')}>
          ←
        </Link>
        {user ? (
          <Avatar src={user.photos.at(0)?.w400 ?? null} alt="" name={name} size={40} />
        ) : null}
        <h1 className="w-chat__title">{name}</h1>
        {user ? (
          <CardSafetyActions
            user={user}
            context="chat"
            conversationId={conversationId}
            onBlocked={() => navigate('/chats', { replace: true })}
          />
        ) : null}
      </header>
      {chat.hasOlder ? (
        <Button variant="ghost" loading={chat.loadingOlder} onClick={() => void chat.loadOlder()}>
          {t('chat.older')}
        </Button>
      ) : null}
      <div
        ref={scroller}
        className="w-chat__scroller"
        role="log"
        aria-live="polite"
        aria-label={t('chat.messages', { name })}
        tabIndex={0}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = /** @type {Row} */ (rows.at(item.index));
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="w-chat__row"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row.type === 'day' ? (
                  <p className="w-chat__day" role="separator">
                    {row.label}
                  </p>
                ) : null}
                {row.type === 'message' ? (
                  <div className={`w-msg${row.mine ? ' w-msg--mine' : ''}`} data-testid="message">
                    {(() => {
                      const Renderer = byKind.get(row.message.kind) ?? TextMessage;
                      return <Renderer message={row.message} />;
                    })()}
                    {row.state ? <MessageState state={row.state} /> : null}
                  </div>
                ) : null}
                {row.type === 'outgoing' ? (
                  <div className="w-msg w-msg--mine w-msg--pending" data-testid="message">
                    <p className="w-msg__text">{row.outgoing.body}</p>
                    <MessageState state={row.outgoing.state} />
                    {row.outgoing.state === 'failed' ? (
                      <>
                        {row.outgoing.error && SEND_ERRORS.has(row.outgoing.error) ? (
                          <span className="v-field__error" role="alert">
                            {t(
                              /** @type {import('@vouch/i18n').MessageKey} */ (
                                SEND_ERRORS.get(row.outgoing.error)
                              ),
                            )}
                          </span>
                        ) : null}
                        <Button variant="ghost" onClick={() => retry(row.outgoing.clientMsgId)}>
                          {t('chat.retry')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {closedKey ? (
        <p className="w-chat__closed" role="status">
          {t(closedKey)}
        </p>
      ) : (
        <Composer conversationId={conversationId} onSend={send} />
      )}
    </section>
  );
}
