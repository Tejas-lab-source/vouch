// @ts-check
import { defineSection } from '@vouch/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildProfilesHandlers } from '../../../src/modules/profiles/adapters/wiring.js';

const USER = '01936f3e-8a4b-7c2d-9e1f-0a1b2c3d4e5f';
const PHOTO = '01936f3e-8a4b-7c2d-9e1f-00000000aaaa';
const CTX = {
  actor: {
    userId: USER,
    audience: /** @type {const} */ ('vouch:user'),
    mfa: false,
    sessionId: 's1',
  },
};

/** In-memory profiles dependencies. */
function setup() {
  const state = {
    profile: /** @type {any} */ ({
      userId: USER,
      collegeId: 'c1',
      clusterId: 'k1',
      name: 'Aditi',
      gender: 0,
      interestedIn: [1],
      bio: null,
      birthDate: '2005-01-31',
      minAge: 18,
      maxAge: 30,
      status: 'pending',
    }),
    photos: /** @type {Map<string, any>} */ (new Map()),
    sections: /** @type {any[]} */ ([]),
    events: /** @type {any[]} */ ([]),
    media: /** @type {any[]} */ ([]),
    invalidated: /** @type {string[]} */ ([]),
  };
  /** @type {import('../../../src/modules/profiles/ports.js').ProfilesStores} */
  const stores = {
    profiles: {
      insertIfMissing: async () => false,
      find: async () => (state.profile ? { ...state.profile } : null),
      findForUpdate: async () => (state.profile ? { ...state.profile } : null),
      update: async (_id, fields) => void Object.assign(state.profile, fields),
      findActiveMany: async () => [],
      remove: async () => {
        state.profile = null;
        state.photos.clear();
        return 1;
      },
    },
    photos: {
      listForUser: async () => [...state.photos.values()].sort((a, b) => a.position - b.position),
      findForUpdate: async (id) => state.photos.get(id) ?? null,
      listForUserForUpdate: async (userId) =>
        [...state.photos.values()]
          .filter((p) => p.userId === userId)
          .sort((a, b) => a.position - b.position),
      setPosition: async (id, position) => void Object.assign(state.photos.get(id), { position }),
      insert: async (p) => void state.photos.set(p.id, { ...p, userId: p.userId }),
      setStatus: async (id, status, keys) =>
        void Object.assign(state.photos.get(id), {
          status,
          key1080: keys?.w1080 ?? null,
          key400: keys?.w400 ?? null,
        }),
      approvedForUsers: async () => [],
    },
    sections: {
      listForUser: async () => state.sections,
      listForUsers: async () => [],
      upsert: async (s) => void state.sections.push(s),
    },
    colleges: { byIds: async () => [{ id: 'c1', name: 'Northfield', clusterId: 'k1' }] },
  };
  const scope = {
    tx: null,
    stores,
    emit: async (/** @type {any} */ e, /** @type {unknown} */ p) =>
      state.events.push({ name: e.name, payload: e.payload.parse(p) }),
    afterCommit: (/** @type {() => unknown} */ fn) => void fn(),
  };
  /** @type {import('../../../src/modules/profiles/ports.js').ProfilesDeps} */
  const deps = {
    useCase: /** @type {any} */ ((/** @type {string} */ _n, /** @type {any} */ h) => h),
    uow: { run: (fn) => fn(/** @type {any} */ (scope)) },
    read: (fn) => fn(stores),
    cards: {
      getMany: async () => new Map(),
      setMany: async () => {},
      invalidate: async (id) => void state.invalidated.push(id),
    },
    identity: {
      getUser: async () => ({
        id: USER,
        publicId: 'pub',
        collegeId: 'c1',
        status: 'active',
        birthDate: '2005-01-31',
      }),
      getUsersByIds: async () => [],
    },
    media: {
      deleteObjects: async (keys) => void state.media.push({ deleteObjects: keys }),
      releaseUpload: async (id) => {
        state.media.push({ releaseUpload: id });
        return { released: true };
      },
      photoUrl: (key) => `https://cdn.test/${key}`,
    },
    sections: new Map([
      [
        'prompts',
        defineSection({
          type: 'prompts',
          schemaVersion: 1,
          owner: 'profiles',
          data: z.strictObject({ answer: z.string().max(10) }),
        }),
      ],
    ]),
    pipelines: { run: async (_name, input) => input },
    clock: { now: () => new Date('2026-11-22T10:00:00Z') },
    photosMax: 6,
  };
  const h = buildProfilesHandlers(deps);
  return { h, state, scope };
}

describe('profile use cases', () => {
  it('refuses an age range whose min exceeds the stored max', async () => {
    const { h } = setup();
    await expect(h.useCases.updateMyProfile({ minAge: 31 }, CTX)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('validates a registered section against its schema and version, and emits sections', async () => {
    const { h, state } = setup();
    const ok = await h.useCases.putSection(
      { type: 'prompts', schemaVersion: 1, position: 0, data: { answer: 'hi' } },
      CTX,
    );
    expect(ok).toEqual({ type: 'prompts', schemaVersion: 1, position: 0, data: { answer: 'hi' } });
    expect(state.events.at(-1)?.payload.changed).toEqual(['sections']);
    await expect(
      h.useCases.putSection(
        { type: 'prompts', schemaVersion: 1, position: 0, data: { answer: 'far too long' } },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      h.useCases.putSection({ type: 'prompts', schemaVersion: 2, position: 0, data: {} }, CTX),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      h.useCases.putSection({ type: 'clubs', schemaVersion: 1, position: 0, data: {} }, CTX),
    ).rejects.toMatchObject({ code: 'UNKNOWN_SECTION_TYPE' });
  });

  it('two approved photos activate the profile; deleting one moves it back to pending', async () => {
    const { h, state, scope } = setup();
    for (const id of [PHOTO, `${PHOTO.slice(0, -4)}bbbb`]) {
      await h.consumers.onPhotoUploaded({ uploadId: id, userId: USER }, scope);
      await h.consumers.onPhotoResult(
        {
          photoId: id,
          uploadId: id,
          userId: USER,
          keys: { w1080: `photos/k/${id}_1080.webp`, w400: `photos/k/${id}_400.webp` },
        },
        'approved',
        scope,
      );
    }
    expect(state.profile.status).toBe('active');
    const view = await h.useCases.deleteMyPhoto({ id: PHOTO }, CTX);
    expect(view.status).toBe('pending');
    expect(view.photos).toHaveLength(1);
    expect(state.media).toContainEqual({ releaseUpload: PHOTO });
    expect(state.events.at(-1)?.payload).toMatchObject({
      status: 'pending',
      changed: ['photos', 'status'],
    });
    expect(state.invalidated).toContain(USER);
  });

  it('a late approval of a deleted photo does not bring it back and releases its files', async () => {
    const { h, state, scope } = setup();
    await h.consumers.onPhotoUploaded({ uploadId: PHOTO, userId: USER }, scope);
    await h.useCases.deleteMyPhoto({ id: PHOTO }, CTX);
    await h.consumers.onPhotoResult(
      {
        photoId: PHOTO,
        uploadId: PHOTO,
        userId: USER,
        keys: { w1080: 'photos/k/a', w400: 'photos/k/b' },
      },
      'approved',
      scope,
    );
    expect(state.photos.get(PHOTO)?.status).toBe('deleted');
    expect(state.media.filter((m) => m.releaseUpload === PHOTO)).toHaveLength(2);
  });

  it('reorders exactly the caller’s current photos; anything else is refused', async () => {
    const { h, state, scope } = setup();
    const second = `${PHOTO.slice(0, -4)}bbbb`;
    const third = `${PHOTO.slice(0, -4)}cccc`;
    for (const id of [PHOTO, second, third]) {
      await h.consumers.onPhotoUploaded({ uploadId: id, userId: USER }, scope);
    }
    await h.useCases.deleteMyPhoto({ id: third }, CTX);
    const view = await h.useCases.reorderMyPhotos({ photoIds: [second, PHOTO] }, CTX);
    expect(view.photos.map((/** @type {any} */ p) => [p.id, p.position])).toEqual([
      [second, 0],
      [PHOTO, 1],
    ]);
    expect(state.invalidated).toContain(USER);
    const events = state.events.length;
    // The same order again is a no-op: no event.
    await h.useCases.reorderMyPhotos({ photoIds: [second, PHOTO] }, CTX);
    expect(state.events).toHaveLength(events);
    for (const photoIds of [[second], [second, PHOTO, third], [second, second], [PHOTO, 'x']]) {
      await expect(h.useCases.reorderMyPhotos({ photoIds }, CTX)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
    state.photos.get(PHOTO).userId = 'someone-else';
    await expect(
      h.useCases.reorderMyPhotos({ photoIds: [second, PHOTO] }, CTX),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('deleting someone else’s photo id changes nothing (idempotent 200)', async () => {
    const { h, state, scope } = setup();
    await h.consumers.onPhotoUploaded({ uploadId: PHOTO, userId: USER }, scope);
    state.photos.get(PHOTO).userId = 'someone-else';
    await h.useCases.deleteMyPhoto({ id: PHOTO }, CTX);
    expect(state.photos.get(PHOTO)?.status).toBe('pending');
    expect(state.media).toEqual([]);
  });

  it('user.deleted.v1 deletes the photo files, then the profile', async () => {
    const { h, state, scope } = setup();
    await h.consumers.onPhotoUploaded({ uploadId: PHOTO, userId: USER }, scope);
    await h.consumers.onPhotoResult(
      {
        photoId: PHOTO,
        uploadId: PHOTO,
        userId: USER,
        keys: { w1080: 'photos/k/a', w400: 'photos/k/b' },
      },
      'approved',
      scope,
    );
    await h.consumers.onUserDeleted({ userId: USER }, scope);
    expect(state.media).toContainEqual({ deleteObjects: ['photos/k/a', 'photos/k/b'] });
    expect(state.profile).toBeNull();
  });
});
