// @ts-check

/**
 * The `text` message renderer (registered in `chat.messageRenderers` by kind). Text is shown
 * as typed: React escapes it, and links are not turned into anchors.
 * @param {{ message: { body: string } }} props
 */
export function TextMessage({ message }) {
  return <p className="w-msg__text">{message.body}</p>;
}
