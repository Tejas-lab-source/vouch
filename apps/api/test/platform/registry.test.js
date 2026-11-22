// @ts-check
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPipelines } from '../../src/platform/pipelines.js';
import { bootModules, defineModule, sortModules } from '../../src/platform/registry.js';

/** @param {string} name @param {string[]} [dependsOn] @param {object} [extra] */
const mod = (name, dependsOn = [], extra = {}) =>
  defineModule({ name, version: 1, dependsOn, ...extra });

describe('defineModule', () => {
  it('validates the manifest and reports the module name', () => {
    expect(() => defineModule(/** @type {any} */ ({ name: 'Bad Name', version: 1 }))).toThrow(
      /Bad Name/,
    );
    expect(() =>
      defineModule(/** @type {any} */ ({ name: 'x', version: 1, http: { routes: 'nope' } })),
    ).toThrow(/routes/);
    expect(() =>
      defineModule(/** @type {any} */ ({ name: 'x', version: 1, unknownKey: 1 })),
    ).toThrow();
    expect(Object.isFrozen(mod('ok'))).toBe(true);
  });
});

describe('sortModules', () => {
  it('orders modules after their dependencies', () => {
    const order = sortModules([
      mod('matching', ['identity', 'safety']),
      mod('safety', ['identity']),
      mod('identity'),
    ]);
    expect(order.map((m) => m.name)).toEqual(['identity', 'safety', 'matching']);
  });

  it('fails on a cycle, naming the modules involved', () => {
    expect(() =>
      sortModules([mod('a', ['b']), mod('b', ['c']), mod('c', ['a']), mod('d')]),
    ).toThrow('module dependency cycle: a, b, c');
  });

  it('fails on unknown dependencies and duplicates', () => {
    expect(() => sortModules([mod('a', ['ghost'])])).toThrow(/unknown module ghost/);
    expect(() => sortModules([mod('a'), mod('a')])).toThrow(/duplicate module/);
  });
});

describe('bootModules', () => {
  const logger = pino({ level: 'silent' });
  const modules = () => [
    mod('identity', [], {
      api: () => ({ getUser: () => 'u1' }),
      http: { routes: async () => 'identity-routes' },
      jobs: { queue: 'fast', handlers: { 'identity.cleanup': async () => 'cleanup-handler' } },
    }),
    mod('matching', ['identity'], {
      api: (/** @type {any} */ ctx) => ({ whoAmI: () => ctx.deps.identity.getUser() }),
      subscribe: { 'user.blocked.v1': async () => 'on-blocked' },
      contribute: {
        'discovery.candidateFilters': async () => ({
          id: 'matching.excludeSwiped',
          order: 20,
          run: () => [],
        }),
      },
      socket: { handlers: async () => 'socket-handlers' },
    }),
  ];

  /** @param {'api' | 'ws' | 'worker' | 'all'} role */
  async function boot(role) {
    const pipelines = createPipelines({ logger });
    pipelines.define('discovery.candidateFilters');
    const result = await bootModules({ modules: modules(), role, platform: { logger }, pipelines });
    return { result, pipelines };
  }

  it('collects section types from manifests and refuses duplicates or a mismatched type', async () => {
    const pipelines = createPipelines({ logger });
    const section = (/** @type {string} */ type) => async () => ({
      type,
      schemaVersion: 1,
      owner: 'clubs',
      data: z.strictObject({ name: z.string() }),
    });
    const ok = await bootModules({
      modules: [mod('clubs', [], { sections: { clubs: section('clubs') } })],
      role: 'api',
      platform: { logger },
      pipelines,
    });
    expect([...ok.sections.keys()]).toEqual(['clubs']);
    await expect(
      bootModules({
        modules: [
          mod('a', [], { sections: { clubs: section('clubs') } }),
          mod('b', [], { sections: { clubs: section('clubs') } }),
        ],
        role: 'api',
        platform: { logger },
        pipelines,
      }),
    ).rejects.toThrow('duplicate section type: clubs');
    await expect(
      bootModules({
        modules: [mod('c', [], { sections: { prompts: section('clubs') } })],
        role: 'api',
        platform: { logger },
        pipelines,
      }),
    ).rejects.toThrow('declares type clubs');
  });

  it('injects dependency APIs in order', async () => {
    const { result } = await boot('api');
    expect(/** @type {any} */ (result.apis.get('matching')).whoAmI()).toBe('u1');
  });

  it('registers only what each role needs', async () => {
    const api = (await boot('api')).result;
    expect(api.routes.map((r) => r.module)).toEqual(['identity']);
    expect(api.consumers).toEqual([]);
    expect(api.jobs).toEqual([]);

    const worker = (await boot('worker')).result;
    expect(worker.routes).toEqual([]);
    expect(worker.consumers).toEqual([
      { module: 'matching', event: 'user.blocked.v1', handler: 'on-blocked' },
    ]);
    expect(worker.jobs).toEqual([
      { module: 'identity', queue: 'fast', name: 'identity.cleanup', handler: 'cleanup-handler' },
    ]);

    const ws = (await boot('ws')).result;
    expect(ws.socketHandlers.map((s) => s.module)).toEqual(['matching']);
    expect(ws.routes).toEqual([]);

    const all = (await boot('all')).result;
    expect([
      all.routes.length,
      all.consumers.length,
      all.jobs.length,
      all.socketHandlers.length,
    ]).toEqual([1, 1, 1, 1]);
  });

  it('records subscriptions and pipeline contributions in every role', async () => {
    const { result, pipelines } = await boot('api');
    expect(result.subscriptions.get('user.blocked.v1')).toEqual(['matching']);
    expect(pipelines.steps('discovery.candidateFilters')).toEqual(['matching.excludeSwiped']);
  });
});
