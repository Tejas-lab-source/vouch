// @ts-check
import { Text, useTheme } from '@vouch/ui-native';

/** The `text` message renderer (`chat.messageRenderers`). @param {{ message: { body: string }, mine?: boolean }} props */
export function TextMessage({ message, mine = false }) {
  const { colors } = useTheme();
  return <Text color={mine ? colors.onPrimary : colors.text}>{message.body}</Text>;
}
