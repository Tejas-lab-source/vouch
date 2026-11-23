// @ts-check

/**
 * A push template. Text never contains a message body, a name or anything personal: a lock
 * screen is public (privacy rule, roadmap Phase 10). `data` holds only ids the client already
 * knows (conversation and match ids), never internal user ids.
 * @typedef {object} PushTemplate
 * @property {string} name
 * @property {'pushMatches' | 'pushMessages' | 'pushLikesDigest'} pref  The preference that turns it off.
 * @property {(params: Record<string, string>) => { title: string, body: string, data: Record<string, string> }} render
 */

/** @type {PushTemplate[]} */
export const V1_TEMPLATES = [
  {
    name: 'match.new',
    pref: 'pushMatches',
    render: (p) => ({
      title: 'It’s a match',
      body: 'Someone you liked likes you too. Say hello.',
      data: { type: 'match.new', matchId: p.matchId ?? '', conversationId: p.matchId ?? '' },
    }),
  },
  {
    name: 'message.new',
    pref: 'pushMessages',
    render: (p) => ({
      title: 'New message',
      body: 'You have a new message.',
      data: { type: 'message.new', conversationId: p.conversationId ?? '' },
    }),
  },
  {
    name: 'likes.digest',
    pref: 'pushLikesDigest',
    render: (p) => ({
      title: 'People like you',
      body:
        Number(p.count) === 1
          ? 'Someone liked your profile.'
          : `${Number(p.count) > 99 ? '99+' : Number(p.count)} people liked your profile.`,
      data: { type: 'likes.digest' },
    }),
  },
];
