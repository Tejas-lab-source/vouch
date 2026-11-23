// @ts-check
import { useConversations } from '@vouch/features-core';
import { useParams } from 'react-router';
import { ConversationView } from '../../widgets/conversation/ConversationView.jsx';

/** `/chats/:conversationId`. */
export function ChatPage() {
  const { conversationId = '' } = useParams();
  const list = useConversations();
  const summary = list.conversations.find((c) => c.conversationId === conversationId) ?? null;
  return (
    <div className="w-page w-page--chat">
      <ConversationView
        key={conversationId}
        conversationId={conversationId}
        user={summary?.user ?? null}
        closed={summary?.closed ?? false}
      />
    </div>
  );
}
