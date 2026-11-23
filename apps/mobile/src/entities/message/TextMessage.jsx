// @ts-check
import { useTheme } from '@vouch/ui-native';
import { Text } from 'react-native';

/** The `text` message renderer (`chat.messageRenderers`). @param {{ message: { body: string }, mine?: boolean }} props */
export function TextMessage({ message, mine = false }) {
  const { colors } = useTheme();
  return <Text style={{ color: mine ? colors.onAccent : colors.text }}>{message.body}</Text>;
}
