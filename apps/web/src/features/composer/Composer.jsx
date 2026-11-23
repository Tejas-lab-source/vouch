// @ts-check
import { Slot } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button } from '@vouch/ui-web';
import { useId, useState } from 'react';

const MAX = 2000;

/**
 * The message composer: Enter sends, Shift+Enter adds a line. `chat.composerActions` items
 * render beside it (none in v1).
 * @param {{ onSend: (text: string) => void, disabled?: boolean, conversationId: string }} props
 */
export function Composer({ onSend, disabled = false, conversationId }) {
  const [text, setText] = useState('');
  const id = useId();
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText('');
  };
  return (
    <form
      className="w-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Slot
        name="chat.composerActions"
        render={(item) => <item.component conversationId={conversationId} />}
      />
      <label className="v-visually-hidden" htmlFor={id}>
        {t('chat.composer.label')}
      </label>
      <textarea
        id={id}
        className="v-input w-composer__input"
        rows={1}
        maxLength={MAX}
        placeholder={t('chat.composer.placeholder')}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" disabled={disabled || !text.trim()}>
        {t('chat.send')}
      </Button>
    </form>
  );
}
