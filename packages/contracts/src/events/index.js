// @ts-check
import { adminEvents } from './admin.js';
import { chatEvents } from './chat.js';
import { discoveryEvents } from './discovery.js';
import { identityEvents } from './identity.js';
import { matchingEvents } from './matching.js';
import { mediaEvents } from './media.js';
import { profilesEvents } from './profiles.js';
import { safetyEvents } from './safety.js';

/** Every v1 domain event, keyed by full name (`noun.verb.vN`). */
export const EVENTS = Object.freeze(
  Object.fromEntries(
    [
      ...identityEvents,
      ...profilesEvents,
      ...mediaEvents,
      ...discoveryEvents,
      ...matchingEvents,
      ...chatEvents,
      ...safetyEvents,
      ...adminEvents,
    ].map((event) => [event.name, event]),
  ),
);

export * from './admin.js';
export * from './chat.js';
export * from './discovery.js';
export * from './envelope.js';
export * from './identity.js';
export * from './matching.js';
export * from './media.js';
export * from './profiles.js';
export * from './safety.js';
