// @ts-check
import { createSharpProcessor } from '../../../src/modules/media/adapters/image/sharp.js';

export const USER = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';
export const NOW = new Date('2026-11-22T10:00:00Z');

/**
 * In-memory media dependencies around the real sharp processor.
 * @param {{ verdict?: 'approve' | 'reject' | 'review', onCheck?: () => Promise<void> }} [options]
 */
export function fakeMediaDeps({ verdict = 'approve', onCheck } = {}) {
  let nowMs = NOW.getTime();
  let ids = 0;
  const state = {
    uploads: /** @type {Map<string, any>} */ (new Map()),
    objects:
      /** @type {Map<string, { body: Buffer, contentType: string, cacheControl?: string }>} */ (
        new Map()
      ),
    events: /** @type {{ name: string, payload: any }[]} */ ([]),
    presigned: /** @type {any[]} */ ([]),
  };

  /** @type {import('../../../src/modules/media/ports.js').MediaStores} */
  const stores = {
    uploads: {
      insert: async (u) =>
        void state.uploads.set(u.id, { ...u, status: 'pending', photoKey: null, errorCode: null }),
      findForUser: async (id, userId) =>
        state.uploads.get(id)?.userId === userId ? { ...state.uploads.get(id) } : null,
      findForUpdate: async (id) => (state.uploads.has(id) ? { ...state.uploads.get(id) } : null),
      listForUser: async (userId) =>
        [...state.uploads.values()].filter((u) => u.userId === userId).map((u) => ({ ...u })),
      markUploaded: async (id) => void Object.assign(state.uploads.get(id), { status: 'uploaded' }),
      startProcessing: async (id, photoKey) => {
        const u = state.uploads.get(id);
        u.status = 'processing';
        u.photoKey ??= photoKey;
        return u.photoKey;
      },
      markApproved: async (id) => void Object.assign(state.uploads.get(id), { status: 'approved' }),
      markRejected: async (id, reason) =>
        void Object.assign(state.uploads.get(id), { status: 'rejected', errorCode: reason }),
      remove: async (id) => void state.uploads.delete(id),
      removeForUser: async (userId) => {
        let n = 0;
        for (const [id, u] of state.uploads)
          if (u.userId === userId) {
            state.uploads.delete(id);
            n += 1;
          }
        return n;
      },
    },
  };

  /** @type {import('../../../src/modules/media/ports.js').StorageProvider} */
  const storage = {
    presignPut: async (input) => {
      state.presigned.push(input);
      return `https://storage.test/${input.key}?signed`;
    },
    head: async (key) => {
      const o = state.objects.get(key);
      return o ? { contentLength: o.body.length, contentType: o.contentType } : null;
    },
    read: async (key) => {
      const o = state.objects.get(key);
      if (!o) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
      return o.body;
    },
    write: async (key, body, { contentType, cacheControl }) =>
      void state.objects.set(key, { body, contentType, cacheControl }),
    remove: async (keys) => keys.forEach((k) => state.objects.delete(k)),
    ensureBucket: async () => {},
  };

  /** @type {import('../../../src/modules/media/ports.js').MediaDeps} */
  const deps = {
    useCase: /** @type {any} */ ((/** @type {string} */ _n, /** @type {any} */ h) => h),
    uow: {
      run: (fn) =>
        fn(
          /** @type {any} */ ({
            tx: null,
            stores,
            emit: async (/** @type {any} */ e, /** @type {unknown} */ p) =>
              state.events.push({ name: e.name, payload: e.payload.parse(p) }),
          }),
        ),
    },
    read: (fn) => fn(stores),
    storage,
    images: createSharpProcessor({ maxPixels: 50_000_000, quality: 80 }),
    contentCheck: {
      check: async () => {
        await onCheck?.();
        return { verdict, reasons: [], provider: 'fake' };
      },
    },
    settings: {
      photosMax: 6,
      uploadMaxBytes: 10_485_760,
      uploadUrlTtlSeconds: 600,
      cdnBaseUrl: 'https://cdn.test/',
    },
    clock: { now: () => new Date(nowMs) },
    newId: () => `01936f3e-8a4b-7c2d-9e1f-${String(++ids).padStart(12, '0')}`,
    randomKey: () => 'R'.repeat(22),
    lockKey: async () => {},
    logger: /** @type {any} */ ({ info() {}, warn() {}, error() {} }),
  };
  return { deps, state, advance: (/** @type {number} */ ms) => void (nowMs += ms) };
}
