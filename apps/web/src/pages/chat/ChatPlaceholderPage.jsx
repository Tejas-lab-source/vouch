// @ts-check
import { t } from '@vouch/i18n';
import { EmptyState } from '@vouch/ui-web';

/** `/chats/:conversationId` until the chat screen lands in Phase 13. */
export function ChatPlaceholderPage() {
  return (
    <div className="w-page">
      <EmptyState title={t('chat.placeholder.title')} body={t('chat.placeholder.body')} />
    </div>
  );
}
