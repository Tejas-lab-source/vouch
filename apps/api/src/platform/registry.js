// @ts-check
import { defineSection, JOBS } from '@vouch/contracts';
import { z } from 'zod';

/** Any function (loaders, factories). */
const Fn = z.custom((value) => typeof value === 'function', 'must be a function');
/** A map of name → loader function. */
const Loaders = z.record(z.string().min(1), Fn);

/**
 * The module manifest (extension points, ARCHITECTURE.md 6.2). Loaders are functions that
 * return (a promise of) the implementation, so a role only loads what it registers.
 */
export const ManifestSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9]*$/),
  version: z.int().min(1),
  dependsOn: z.array(z.string()).default([]),
  api: Fn.optional().describe('(ctx) => public API other modules may call'),
  http: z.strictObject({ routes: Fn }).optional(),
  socket: z.strictObject({ handlers: Fn }).optional(),
  jobs: z
    .strictObject({ queue: z.enum(['fast', 'bulk', 'media', 'external']), handlers: Loaders })
    .optional(),
  subscribe: Loaders.optional().describe('event name → handler loader'),
  contribute: Loaders.optional().describe('pipeline name → step loader'),
  sections: Loaders.optional(),
  messageKinds: Loaders.optional(),
  templates: Loaders.optional(),
  exports: Fn.optional().describe(
    '(ctx) => (userId) => this module’s personal data for the export',
  ),
  schedules: z
    .array(
      z.strictObject({ id: z.string().min(1), cron: z.string().min(9), job: z.string().min(1) }),
    )
    .default([])
    .describe('Repeatable jobs (UTC cron), registered by worker roles; run once across workers'),
  flags: z.array(z.string()).default([]),
  admin: z.strictObject({ panels: Fn }).optional(),
  migrations: z.instanceof(URL).optional(),
});

/** @typedef {z.output<typeof ManifestSchema>} Manifest */
/** @typedef {z.input<typeof ManifestSchema>} ManifestInput */

/**
 * Validates and freezes a module manifest. Throws with the module name on any problem.
 * @param {ManifestInput} manifest
 * @returns {Readonly<Manifest>}
 */
export function defineModule(manifest) {
  const parsed = ManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const name = typeof manifest?.name === 'string' ? manifest.name : '(unnamed)';
    throw new Error(
      `invalid manifest for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  return Object.freeze(parsed.data);
}

/**
 * Orders modules so every module comes after the modules it depends on (Kahn's algorithm).
 * Fails on duplicates, unknown dependencies and cycles, naming the modules involved.
 * @param {readonly Manifest[]} modules
 * @returns {Manifest[]}
 */
export function sortModules(modules) {
  const byName = new Map();
  for (const module of modules) {
    if (byName.has(module.name)) throw new Error(`duplicate module: ${module.name}`);
    byName.set(module.name, module);
  }
  for (const module of modules) {
    for (const dep of module.dependsOn) {
      if (!byName.has(dep))
        throw new Error(`module ${module.name} depends on unknown module ${dep}`);
    }
  }
  const remaining = new Map(modules.map((m) => [m.name, new Set(m.dependsOn)]));
  /** @type {Manifest[]} */
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => deps.size === 0)
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) {
      throw new Error(`module dependency cycle: ${[...remaining.keys()].sort().join(', ')}`);
    }
    for (const name of ready) {
      ordered.push(byName.get(name));
      remaining.delete(name);
      for (const deps of remaining.values()) deps.delete(name);
    }
  }
  return ordered;
}

/** What each role registers. `all` registers everything (beta). */
export const ROLE_CAPABILITIES = Object.freeze({
  api: { http: true, socket: false, workers: false },
  ws: { http: false, socket: true, workers: false },
  worker: { http: false, socket: false, workers: true },
  all: { http: true, socket: true, workers: true },
});

const CAPABILITIES_BY_ROLE = new Map(Object.entries(ROLE_CAPABILITIES));

/**
 * What a role registers.
 * @param {string} role
 * @returns {{ http: boolean, socket: boolean, workers: boolean }}
 */
export function capabilitiesOf(role) {
  const capabilities = CAPABILITIES_BY_ROLE.get(role);
  if (!capabilities) throw new Error(`unknown role: ${role}`);
  return capabilities;
}

/**
 * @typedef {object} BootResult
 * @property {Map<string, unknown>} apis  Module name → public API.
 * @property {Map<string, readonly string[]>} subscriptions  Event name → consumer modules.
 * @property {{ module: string, plugin: unknown }[]} routes  HTTP route plugins (api, all).
 * @property {{ module: string, handlers: unknown }[]} socketHandlers  (ws, all; used from Phase 9).
 * @property {{ module: string, queue: string, name: string, handler: unknown }[]} jobs  (worker, all).
 * @property {{ module: string, event: string, handler: unknown }[]} consumers  (worker, all).
 * @property {{ module: string, id: string, cron: string, job: string }[]} schedules  (worker, all).
 * @property {Map<string, (userId: string) => Promise<Record<string, unknown>>>} exporters
 *   Module name → personal-data exporter (filled during boot; read at call time).
 * @property {Map<string, Readonly<import('@vouch/contracts').SectionDefinition>>} sections
 *   Section type → definition (manifest key `sections`, extension point 9; filled during boot).
 * @property {Map<string, any>} templates  Notification template name → definition (manifest key
 *   `templates`, Phase 10; filled during boot, read at send time).
 * @property {any[]} adminPanels  Admin panel definitions (manifest key `admin.panels`, Phase 10).
 */

/**
 * Boots modules in dependency order: builds each module's API with its dependencies' APIs
 * injected, contributes pipeline steps, and loads only what the role registers.
 * @param {{
 *   modules: readonly Manifest[],
 *   role: keyof typeof ROLE_CAPABILITIES,
 *   platform: Record<string, unknown>,
 *   pipelines: import('./pipelines.js').Pipelines,
 * }} options
 * @returns {Promise<BootResult>}
 */
export async function bootModules({ modules, role, platform, pipelines }) {
  const capabilities = capabilitiesOf(role);
  /** @type {BootResult} */
  const result = {
    apis: new Map(),
    subscriptions: new Map(),
    routes: [],
    socketHandlers: [],
    jobs: [],
    consumers: [],
    schedules: [],
    exporters: new Map(),
    sections: new Map(),
    templates: new Map(),
    adminPanels: [],
  };

  for (const module of sortModules(modules)) {
    const deps = Object.fromEntries(module.dependsOn.map((name) => [name, result.apis.get(name)]));
    const ctx = {
      ...platform,
      module: module.name,
      deps,
      exporters: result.exporters,
      sections: result.sections,
      templates: result.templates,
      adminPanels: result.adminPanels,
      subscriptions: result.subscriptions,
    };
    if (module.api) result.apis.set(module.name, await module.api(ctx));
    if (module.exports) result.exporters.set(module.name, await module.exports(ctx));

    for (const [type, load] of Object.entries(module.sections ?? {})) {
      if (result.sections.has(type)) throw new Error(`duplicate section type: ${type}`);
      const definition = defineSection(await load(ctx));
      if (definition.type !== type) {
        throw new Error(`section ${type} of ${module.name} declares type ${definition.type}`);
      }
      result.sections.set(type, definition);
    }
    for (const [name, load] of Object.entries(module.templates ?? {})) {
      if (result.templates.has(name)) throw new Error(`duplicate notification template: ${name}`);
      result.templates.set(name, await load(ctx));
    }
    if (module.admin) result.adminPanels.push(...(await module.admin.panels(ctx)));
    for (const [pipeline, load] of Object.entries(module.contribute ?? {})) {
      pipelines.contribute(pipeline, await load(ctx));
    }
    for (const event of Object.keys(module.subscribe ?? {})) {
      result.subscriptions.set(event, [...(result.subscriptions.get(event) ?? []), module.name]);
    }

    if (capabilities.http && module.http) {
      result.routes.push({ module: module.name, plugin: await module.http.routes(ctx) });
    }
    if (capabilities.socket && module.socket) {
      result.socketHandlers.push({
        module: module.name,
        handlers: await module.socket.handlers(ctx),
      });
    }
    if (capabilities.workers) {
      for (const [name, load] of Object.entries(module.jobs?.handlers ?? {})) {
        result.jobs.push({
          module: module.name,
          // The contract names each job's queue (enqueue uses it too); the module's queue is
          // the fallback for jobs outside the contracts (tests).
          queue: new Map(Object.entries(JOBS)).get(name)?.queue ?? module.jobs?.queue ?? 'fast',
          name,
          handler: await load(ctx),
        });
      }
      for (const [event, load] of Object.entries(module.subscribe ?? {})) {
        result.consumers.push({ module: module.name, event, handler: await load(ctx) });
      }
      for (const schedule of module.schedules)
        result.schedules.push({ module: module.name, ...schedule });
    }
  }
  return result;
}
