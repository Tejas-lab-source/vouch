// @ts-check

/**
 * The named UI slots features fill (roadmap Phase 11). A new screen part is a new feature that
 * registers into a slot; existing screens are not edited.
 */
export const SLOTS = Object.freeze([
  'home.tabs',
  'profile.sections',
  'profile.editor',
  'chat.composerActions',
  'chat.messageRenderers',
  'deck.cardBadges',
  'settings.rows',
]);

/**
 * @typedef {object} SlotItem
 * @property {string} id  Unique within the slot.
 * @property {number} [order]  Lower first (default 100).
 * @property {any} [component]  What the slot renders (a React component on web and mobile).
 * @property {Record<string, unknown>} [props]  Static props or data (for example a tab label key).
 */

/**
 * @typedef {object} ClientFeature
 * @property {string} id
 * @property {string} [flag]  Shown only while this flag is on (`GET /v1/config` flags).
 * @property {Partial<Record<(typeof SLOTS)[number], SlotItem[]>>} slots
 */

/**
 * Declares a client feature. Validates slot names and ids at definition time, so a typo fails
 * at start-up, not silently.
 * @param {ClientFeature} feature
 * @returns {Readonly<ClientFeature>}
 */
export function defineClientFeature(feature) {
  if (!/^[a-z][a-z0-9.-]{1,59}$/.test(feature.id)) throw new Error(`bad feature id ${feature.id}`);
  for (const [slot, items] of Object.entries(feature.slots)) {
    if (!SLOTS.includes(/** @type {any} */ (slot))) {
      throw new Error(`${feature.id}: unknown slot ${slot}`);
    }
    for (const item of items ?? []) {
      if (!item.id) throw new Error(`${feature.id}: a ${slot} item has no id`);
    }
  }
  return Object.freeze({ ...feature });
}

/**
 * A registry of client features (one per app).
 * @param {readonly Readonly<ClientFeature>[]} [features]
 */
export function createFeatureRegistry(features = []) {
  /** @type {Readonly<ClientFeature>[]} */
  const all = [];
  const registry = {
    /** @param {Readonly<ClientFeature>} feature */
    register(feature) {
      if (all.some((f) => f.id === feature.id)) throw new Error(`duplicate feature ${feature.id}`);
      all.push(feature);
      return registry;
    },
    /**
     * The items for one slot, from features whose flag is on (or that have none), in order.
     * @param {(typeof SLOTS)[number]} slot
     * @param {Record<string, boolean>} flags
     * @returns {(SlotItem & { feature: string })[]}
     */
    itemsFor(slot, flags) {
      const enabled = new Map(Object.entries(flags));
      return all
        .filter((f) => !f.flag || enabled.get(f.flag) === true)
        .flatMap((f) =>
          (new Map(Object.entries(f.slots)).get(slot) ?? []).map((item) => ({
            ...item,
            feature: f.id,
          })),
        )
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
    },
    /** Every registered feature id (for diagnostics). */
    ids: () => all.map((f) => f.id),
  };
  for (const feature of features) registry.register(feature);
  return registry;
}

/** @typedef {ReturnType<typeof createFeatureRegistry>} FeatureRegistry */
