// @ts-check
import { useMarkRead, useMessages, useSendMessage, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Skeleton, useTheme } from '@vouch/ui-native';
import { useEffect, useMemo, useState } from 'react';
import { AppState, FlatList, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { TextMessage } from '../../entities/message/TextMessage.jsx';
import { Composer } from '../../features/composer/Composer.jsx';

/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const STATE = new Map([
  ['sending', 'chat.state.sending'],
  ['sent', 'chat.state.sent'],
  ['delivered', 'chat.state.delivered'],
  ['read', 'chat.state.read'],
  ['failed', 'chat.state.failed'],
]);

/** Whether the app is in the foreground (read receipts only while it is). */
function useForeground() {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

/**
 * One conversation: an inverted FlatList (virtualised; newest at the bottom), date separators,
 * my messages' states, older pages on reaching the top, the closed state and the composer.
 * @param {{ conversationId: string, closed?: boolean }} props
 */
export function ConversationView({ conversationId, closed = false }) {
  const { colors, space, radius } = useTheme();
  const chat = useMessages(conversationId);
  const { send, retry } = useSendMessage(conversationId);
  useMarkRead(conversationId, chat.messages, useForeground());
  const renderers = useSlotItems('chat.messageRenderers');
  const byKind = useMemo(
    () => new Map(renderers.map((i) => [/** @type {string} */ (i.props?.kind), i.component])),
    [renderers],
  );

  const rows = useMemo(() => {
    /** @type {any[]} */
    const out = [];
    let day = '';
    for (const m of chat.messages) {
      const d = m.createdAt.slice(0, 10);
      if (d !== day) {
        out.push({
          type: 'day',
          key: `day-${d}`,
          label: new Date(m.createdAt).toLocaleDateString(),
        });
        day = d;
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
    return out.reverse(); // inverted list: newest first
  }, [chat]);

  if (chat.isLoading && chat.messages.length === 0) return <Skeleton height={48} />;
  if (chat.isError && chat.messages.length === 0) return <EmptyState title={t('chat.notFound')} />;
  const ended = chat.closed ?? (closed ? 'unmatched' : null);

  /** @param {{ item: any }} props */
  const renderItem = ({ item }) => {
    if (item.type === 'day') {
      return (
        <Text
          accessibilityRole="header"
          style={{ textAlign: 'center', color: colors.textMuted, marginVertical: space[2] }}
        >
          {item.label}
        </Text>
      );
    }
    const mine = item.type === 'outgoing' || item.mine;
    const Renderer =
      item.type === 'message' ? (byKind.get(item.message.kind) ?? TextMessage) : TextMessage;
    const state = item.type === 'outgoing' ? item.outgoing.state : item.state;
    return (
      <View
        style={{
          alignSelf: mine ? 'flex-end' : 'flex-start',
          maxWidth: '78%',
          marginVertical: space[1],
          padding: space[2],
          borderRadius: radius.lg,
          backgroundColor: mine ? colors.accent : colors.surface,
          borderWidth: 1,
          borderColor: mine ? colors.accent : colors.border,
        }}
      >
        <Renderer message={item.type === 'outgoing' ? item.outgoing : item.message} mine={mine} />
        {state ? (
          <Text
            style={{
              color: mine ? colors.onAccent : colors.textMuted,
              fontSize: 12,
              alignSelf: 'flex-end',
            }}
          >
            {t(/** @type {import('@vouch/i18n').MessageKey} */ (STATE.get(state)))}
          </Text>
        ) : null}
        {item.type === 'outgoing' && item.outgoing.state === 'failed' ? (
          <Button
            variant="ghost"
            title={t('chat.retry')}
            onPress={() => retry(item.outgoing.clientMsgId)}
          />
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        inverted
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        contentContainerStyle={{ padding: space[3] }}
        onEndReached={() => void chat.loadOlder()}
        onEndReachedThreshold={0.3}
        initialNumToRender={20}
        windowSize={11}
        accessibilityLabel={t('chat.messages', { name: '' })}
      />
      {ended ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ textAlign: 'center', color: colors.textMuted, padding: space[3] }}
        >
          {t(ended === 'deleted' ? 'chat.closed.deleted' : 'chat.closed.unmatched')}
        </Text>
      ) : (
        <Composer onSend={send} />
      )}
    </KeyboardAvoidingView>
  );
}
