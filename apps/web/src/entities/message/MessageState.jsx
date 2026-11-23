// @ts-check
import { t } from '@vouch/i18n';

/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const LABELS = new Map([
  ['sending', 'chat.state.sending'],
  ['sent', 'chat.state.sent'],
  ['delivered', 'chat.state.delivered'],
  ['read', 'chat.state.read'],
  ['failed', 'chat.state.failed'],
]);

/** A message's delivery state, as text (never colour alone). @param {{ state: string }} props */
export function MessageState({ state }) {
  return (
    <span className={`w-msg__state w-msg__state--${state}`}>
      {t(/** @type {import('@vouch/i18n').MessageKey} */ (LABELS.get(state)))}
    </span>
  );
}
