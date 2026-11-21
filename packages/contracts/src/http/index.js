// @ts-check
import { adminEndpoints } from './admin.js';
import { chatEndpoints } from './chat.js';
import { discoveryEndpoints } from './discovery.js';
import { identityEndpoints } from './identity.js';
import { mediaEndpoints } from './media.js';
import { matchingEndpoints } from './matching.js';
import { notificationsEndpoints } from './notifications.js';
import { platformEndpoints } from './platform.js';
import { profilesEndpoints } from './profiles.js';
import { safetyEndpoints } from './safety.js';

/** Every v1 REST endpoint, grouped by owning module. */
export const ENDPOINTS = Object.freeze([
  ...identityEndpoints,
  ...platformEndpoints,
  ...profilesEndpoints,
  ...mediaEndpoints,
  ...discoveryEndpoints,
  ...matchingEndpoints,
  ...chatEndpoints,
  ...safetyEndpoints,
  ...notificationsEndpoints,
  ...adminEndpoints,
]);

const seen = new Set();
for (const endpoint of ENDPOINTS) {
  const route = `${endpoint.method} ${endpoint.path}`;
  if (seen.has(endpoint.id) || seen.has(route))
    throw new Error(`duplicate endpoint: ${endpoint.id} (${route})`);
  seen.add(endpoint.id).add(route);
}

export * from './admin.js';
export * from './chat.js';
export * from './discovery.js';
export * from './endpoint.js';
export * from './identity.js';
export * from './matching.js';
export * from './media.js';
export * from './notifications.js';
export * from './platform.js';
export * from './profiles.js';
export * from './safety.js';
