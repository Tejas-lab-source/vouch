// @ts-check
import { t } from '@vouch/i18n';
import { Button, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

/** The message composer. @param {{ onSend: (text: string) => void }} props */
export function Composer({ onSend }) {
  const { colors, space, radius, minTouchTarget } = useTheme();
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <View
      style={{ flexDirection: 'row', gap: space[2], padding: space[2], alignItems: 'flex-end' }}
    >
      <TextInput
        accessibilityLabel={t('chat.composer.label')}
        placeholder={t('chat.composer.placeholder')}
        placeholderTextColor={colors.textMuted}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={2000}
        style={{
          flex: 1,
          minHeight: minTouchTarget,
          maxHeight: 140,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: space[3],
          color: colors.text,
        }}
      />
      <Button title={t('chat.send')} disabled={!text.trim()} onPress={send} />
    </View>
  );
}
