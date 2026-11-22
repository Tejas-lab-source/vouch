// @ts-check
import { t } from '@vouch/i18n';
import { EmptyState, useTheme } from '@vouch/ui-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** `/chat/[id]` until the chat screen lands in Phase 13. */
export function ChatPlaceholderScreen() {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <EmptyState title={t('chat.placeholder.title')} body={t('chat.placeholder.body')} />
    </SafeAreaView>
  );
}
