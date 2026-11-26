// @ts-check
import { t } from '@vouch/i18n';
import { IconButton, Send, useTheme } from '@vouch/ui-native';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

/** The message composer. @param {{ onSend: (text: string) => void }} props */
export function Composer({ onSend }) {
  const { colors, space, radius, font } = useTheme();
  const [text, setText] = useState('');
  const send = () => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space[2],
        padding: space[3],
        alignItems: 'flex-end',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.borderSubtle,
      }}
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
          ...font('body'),
          flex: 1,
          minHeight: 48,
          maxHeight: 140,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.button,
          paddingHorizontal: space[4],
          paddingVertical: space[3],
          color: colors.text,
          backgroundColor: colors.background,
        }}
      />
      <IconButton
        icon={Send}
        label={t('chat.send')}
        variant="primary"
        disabled={!text.trim()}
        onPress={send}
      />
    </View>
  );
}
