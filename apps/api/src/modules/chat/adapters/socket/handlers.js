// @ts-check

/**
 * Chat's socket handlers (`socket.handlers`): the four client events, and presence kept by the
 * connection lifecycle.
 * @param {{
 *   send: (input: any, ctx: any) => Promise<unknown>,
 *   sync: (input: any, ctx: any) => Promise<unknown>,
 *   markRead: (input: any, ctx: any) => Promise<unknown>,
 *   markDelivered: (input: any, ctx: any) => Promise<unknown>,
 *   presence: import('../../ports.js').Presence,
 * }} deps
 * @returns {import('../../../../platform/ws.js').SocketHandlers}
 */
export function chatSocketHandlers({ send, sync, markRead, markDelivered, presence }) {
  return {
    events: {
      'message.send': send,
      sync,
      'message.read': markRead,
      'message.delivered': markDelivered,
    },
    onConnect: (ctx) => presence.touch(ctx.actor.userId),
    onHeartbeat: (ctx) => presence.touch(ctx.actor.userId),
    onDisconnect: (ctx, remaining) =>
      remaining === 0 ? presence.clear(ctx.actor.userId) : undefined,
  };
}
