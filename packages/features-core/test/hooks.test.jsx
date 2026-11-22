// @ts-check
import { ApiError, createApiClient, keys } from '@vouch/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AppServicesProvider,
  createFeatureRegistry,
  createLogAnalytics,
  fitWithin,
  memoryPrefs,
  mergePage,
  nextOnboardingStep,
  sanitizeProps,
  uploadPhoto,
  useDeck,
  useDeletePhoto,
  useMyProfile,
  useOnboarding,
  useReorderPhotos,
  useSwipe,
  useUnmatch,
  useMatches,
} from '../src/index.js';

const ID = (/** @type {number} */ n) => `01936f3e-8a4b-7c2d-9e1f-${String(n).padStart(12, '0')}`;
const card = (/** @type {number} */ n) => ({
  userId: ID(n),
  name: `P${n}`,
  age: 20,
  gender: 0,
  collegeName: 'Northfield',
  bio: null,
  photos: [{ w400: 'http://cdn/a_400.webp', w1080: 'http://cdn/a_1080.webp' }],
  sections: [],
});
const photo = (/** @type {number} */ n, status = 'approved', position = n) => ({
  id: ID(n),
  position,
  status,
  urls: status === 'approved' ? { w400: 'http://cdn/x', w1080: 'http://cdn/y' } : null,
});
/** @returns {any} */
const profile = (/** @type {Partial<any>} */ over = {}) => ({
  userId: ID(900),
  status: 'pending',
  name: 'Asha',
  gender: 0,
  interestedIn: [1],
  bio: null,
  age: 21,
  minAge: 18,
  maxAge: 30,
  photos: [],
  sections: [],
  missing: ['photos'],
  ...over,
});

/**
 * A scripted API: each route is a function of (body, callIndex) returning [status, body].
 * Calls are recorded.
 * @param {Record<string, (body: any, n: number, url: URL) => [number, unknown] | Promise<[number, unknown]>>} routes
 */
function fakeApi(routes) {
  /** @type {{ route: string, body: any, headers: Record<string, string> }[]} */
  const calls = [];
  /** @type {Map<string, number>} */
  const counts = new Map();
  const fetch = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace(/[0-9a-f-]{36}/g, ':id')}`;
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ route: key, body, headers: init.headers });
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      const handler = new Map(Object.entries(routes)).get(key);
      const [status, payload] = handler
        ? await handler(body, n, u)
        : [404, { error: { code: 'NOT_FOUND', message: 'x' } }];
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
  );
  const client = createApiClient({
    baseUrl: 'http://api',
    appVersion: '1.0.0',
    fetch,
    tokens: { get: () => 'token', refresh: async () => 'token' },
  });
  return {
    client,
    calls,
    count: (/** @type {string} */ route) => calls.filter((c) => c.route === route).length,
  };
}

/** @param {ReturnType<typeof fakeApi>} api @param {Partial<import('../src/react.jsx').AppServices>} [extra] */
function wrapper(api, extra = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tracked = /** @type {string[]} */ ([]);
  let ids = 0;
  const services = /** @type {any} */ ({
    client: api.client,
    session: {},
    registry: createFeatureRegistry([]),
    auth: {},
    analytics: {
      track: (/** @type {string} */ e, /** @type {any} */ p) =>
        tracked.push(`${e} ${JSON.stringify(p ?? {})}`),
    },
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    ...extra,
  });
  const Wrapper = (/** @type {{ children: any }} */ { children }) => (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={services}>{children}</AppServicesProvider>
    </QueryClientProvider>
  );
  return { Wrapper, queryClient, tracked };
}

const serverError = () =>
  /** @type {[number, unknown]} */ ([503, { error: { code: 'UNAVAILABLE', message: 'x' } }]);

/** A 503 after a short delay, so the optimistic state is observable. */
const slowServerError = async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  return serverError();
};

describe('photo upload state machine', () => {
  const io = (/** @type {{ failPut?: number }} */ { failPut = 0 } = {}) => {
    let puts = 0;
    return {
      puts: () => puts,
      prepare: vi.fn(async () => ({
        body: 'bytes',
        contentType: /** @type {const} */ ('image/jpeg'),
        sizeBytes: 5,
      })),
      put: vi.fn(async (/** @type {any} */ { onProgress, headers }) => {
        puts += 1;
        expect(headers['content-type']).toBe('image/jpeg');
        onProgress(0.5);
        if (puts <= failPut) throw new ApiError({ code: 'NETWORK', message: 'x', status: 0 });
        onProgress(1);
      }),
    };
  };
  const presign = (/** @type {number} */ n) => () =>
    /** @type {[number, unknown]} */ ([
      201,
      {
        uploadId: ID(n),
        url: 'http://storage/put',
        method: 'PUT',
        headers: { 'content-type': 'image/jpeg', 'content-length': '5' },
        expiresAt: '2026-11-22T10:00:00.000Z',
      },
    ]);

  it('goes preparing → uploading (progress) → confirming → processing → approved, polling the profile', async () => {
    const api = fakeApi({
      'POST /v1/media/uploads': presign(1),
      'POST /v1/media/uploads/:id/confirm': () => [202, { uploadId: ID(1), status: 'processing' }],
      'GET /v1/me/profile': (_b, n) => [
        200,
        profile({ photos: [photo(1, n < 1 ? 'pending' : 'approved')] }),
      ],
    });
    /** @type {string[]} */
    const seen = [];
    const { state } = await uploadPhoto({
      client: api.client,
      io: io(),
      file: {},
      sleep: async () => {},
      onState: (s) => seen.push(s.phase === 'uploading' ? `uploading ${s.progress}` : s.phase),
    });
    expect(state).toMatchObject({ phase: 'approved', photoId: ID(1) });
    expect([...new Set(seen)]).toEqual([
      'preparing',
      'uploading 0',
      'uploading 0.5',
      'uploading 1',
      'confirming',
      'processing',
      'approved',
    ]);
    expect(api.count('GET /v1/me/profile')).toBe(2);
  });

  it('a failed PUT ends in failed; a retry presigns again; a failed confirm retries only the confirm', async () => {
    const api = fakeApi({
      'POST /v1/media/uploads': presign(2),
      'POST /v1/media/uploads/:id/confirm': (_b, n) =>
        n === 0 ? serverError() : [202, { uploadId: ID(2), status: 'rejected' }],
    });
    const files = io({ failPut: 1 });
    const first = await uploadPhoto({ client: api.client, io: files, file: {}, onState: () => {} });
    expect(first).toMatchObject({ state: { phase: 'failed' }, uploadId: null });
    const second = await uploadPhoto({
      client: api.client,
      io: files,
      file: {},
      onState: () => {},
    });
    expect(second).toMatchObject({ state: { phase: 'failed' }, uploadId: ID(2) }); // confirm 503
    const third = await uploadPhoto({
      client: api.client,
      io: files,
      file: {},
      resume: { uploadId: ID(2) },
      onState: () => {},
    });
    expect(third.state.phase).toBe('rejected');
    expect(api.count('POST /v1/media/uploads')).toBe(2); // not again on the confirm retry
    expect(files.puts()).toBe(2);
  });

  it('stops polling after the timeout and reports pending (held for review)', async () => {
    const api = fakeApi({
      'POST /v1/media/uploads': presign(3),
      'POST /v1/media/uploads/:id/confirm': () => [202, { uploadId: ID(3), status: 'processing' }],
      'GET /v1/me/profile': () => [200, profile({ photos: [photo(3, 'pending')] })],
    });
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { state } = await uploadPhoto({
      client: api.client,
      io: io(),
      file: {},
      pollTimeoutMs: 3000,
      sleep: async (ms) => {
        now += ms;
      },
      onState: () => {},
    });
    vi.restoreAllMocks();
    expect(state.phase).toBe('pending');
  });

  it('fits images within 2048 px on the long edge, never upscaling', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 6000)).toEqual({ width: 1024, height: 2048 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('deck and swipe', () => {
  it('removes the card at once; a 5xx is retried with the same swipeId, then the card comes back in place', async () => {
    const api = fakeApi({
      'GET /v1/deck': () => [200, { cards: [card(1), card(2), card(3), card(4), card(5)] }],
      'POST /v1/swipes': slowServerError,
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(
      () => ({ deck: useDeck(), swipe: useSwipe({ retryDelayMs: 1 }) }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.deck.cards).toHaveLength(5));
    /** @type {Promise<unknown>} */
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.swipe.like(/** @type {any} */ (card(2)));
    });
    await waitFor(() =>
      expect(result.current.deck.cards.map((c) => c.name)).toEqual(['P1', 'P3', 'P4', 'P5']),
    );
    await act(async () => {
      await pending;
    });
    const swipes = api.calls.filter((c) => c.route === 'POST /v1/swipes');
    expect(swipes).toHaveLength(3);
    expect(new Set(swipes.map((c) => c.body.swipeId)).size).toBe(1);
    await waitFor(() =>
      expect(result.current.deck.cards.map((c) => c.name)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']),
    );
  });

  it('a card the server refuses (NOT_SERVED) is not put back', async () => {
    const api = fakeApi({
      'GET /v1/deck': () => [200, { cards: [card(1), card(2), card(3), card(4), card(5)] }],
      'POST /v1/swipes': () => [409, { error: { code: 'NOT_SERVED', message: 'x' } }],
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ deck: useDeck(), swipe: useSwipe() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.deck.cards).toHaveLength(5));
    await act(async () => {
      await result.current.swipe.pass(/** @type {any} */ (card(1)));
    });
    await waitFor(() =>
      expect(result.current.deck.cards.map((c) => c.name)).toEqual(['P2', 'P3', 'P4', 'P5']),
    );
    expect(api.count('POST /v1/swipes')).toBe(1);
  });

  it('a like that matches calls onMatch, tracks swipe and match, and refreshes matches', async () => {
    const api = fakeApi({
      'GET /v1/deck': () => [200, { cards: [card(1), card(2), card(3), card(4), card(5)] }],
      'POST /v1/swipes': () => [200, { matched: true, matchId: ID(77) }],
    });
    const { Wrapper, tracked, queryClient } = wrapper(api);
    const onMatch = vi.fn();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => ({ deck: useDeck(), swipe: useSwipe({ onMatch }) }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.deck.cards).toHaveLength(5));
    await act(async () => {
      await result.current.swipe.like(/** @type {any} */ (card(1)));
    });
    expect(onMatch).toHaveBeenCalledWith({ matchId: ID(77), card: card(1) });
    expect(tracked).toEqual([
      'deck_viewed {"cards":5}',
      'swipe {"direction":"like"}',
      'match {"source":"swipe"}',
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.matches() });
  });

  it('fetches the next page when 3 cards remain, drops duplicates, and is caught up when nothing new comes', async () => {
    const api = fakeApi({
      'GET /v1/deck': (_b, n) => [
        200,
        {
          cards:
            n === 0
              ? [card(1), card(2), card(3), card(4)]
              : n === 1
                ? [card(4), card(5)]
                : [card(5)],
        },
      ],
      'POST /v1/swipes': () => [200, { matched: false, matchId: null }],
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ deck: useDeck(), swipe: useSwipe() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.deck.cards).toHaveLength(4));
    expect(api.count('GET /v1/deck')).toBe(1); // 4 > 3: no prefetch yet
    await act(async () => {
      await result.current.swipe.pass(/** @type {any} */ (card(1)));
    });
    await waitFor(() =>
      expect(result.current.deck.cards.map((c) => c.name)).toEqual(['P2', 'P3', 'P4', 'P5']),
    );
    for (const n of [2, 3, 4, 5]) {
      await act(async () => {
        await result.current.swipe.pass(/** @type {any} */ (card(n)));
      });
    }
    await waitFor(() => expect(result.current.deck.exhausted).toBe(true));
    expect(result.current.deck.cards).toEqual([]);
  });

  it('mergePage never re-adds a card swiped while a page was in flight', () => {
    const deck = { cards: [card(2)], removed: [ID(1)], exhausted: false };
    expect(
      mergePage(
        /** @type {any} */ (deck),
        /** @type {any} */ ([card(1), card(2), card(3)]),
      ).cards.map((c) => c.name),
    ).toEqual(['P2', 'P3']);
  });
});

describe('profile photos and matches', () => {
  it('reorder is optimistic and rolled back when the server refuses', async () => {
    const api = fakeApi({
      'GET /v1/me/profile': () => [200, profile({ photos: [photo(1), photo(2)] })],
      'PUT /v1/me/photos/order': async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return [400, { error: { code: 'VALIDATION_FAILED', message: 'x' } }];
      },
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ me: useMyProfile(), reorder: useReorderPhotos() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.me.data?.photos).toHaveLength(2));
    const order = () => result.current.me.data?.photos.map((/** @type {any} */ p) => p.id);
    /** @type {Promise<unknown>} */
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.reorder.mutateAsync([ID(2), ID(1)]).catch(() => {});
    });
    await waitFor(() => expect(order()).toEqual([ID(2), ID(1)])); // optimistic
    await act(async () => {
      await pending;
    });
    await waitFor(() => expect(order()).toEqual([ID(1), ID(2)])); // rolled back
    expect(api.calls.find((c) => c.route === 'PUT /v1/me/photos/order')?.body).toEqual({
      photoIds: [ID(2), ID(1)],
    });
  });

  it('delete removes the photo at once and restores it on error', async () => {
    const api = fakeApi({
      'GET /v1/me/profile': () => [200, profile({ photos: [photo(1), photo(2)] })],
      'DELETE /v1/me/photos/:id': slowServerError,
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ me: useMyProfile(), del: useDeletePhoto() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.me.data?.photos).toHaveLength(2));
    /** @type {Promise<unknown>} */
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.del.mutateAsync(ID(1)).catch(() => {});
    });
    await waitFor(() => expect(result.current.me.data?.photos).toHaveLength(1));
    await act(async () => {
      await pending;
    });
    await waitFor(() => expect(result.current.me.data?.photos).toHaveLength(2));
  });

  it('unmatch takes the match out of the list', async () => {
    const summary = (/** @type {number} */ n) => ({
      matchId: ID(n),
      conversationId: ID(n),
      user: card(n),
      createdAt: '2026-11-22T10:00:00.000Z',
    });
    const api = fakeApi({
      'GET /v1/matches': () => [200, { items: [summary(1), summary(2)], nextCursor: null }],
      'POST /v1/matches/:id/unmatch': () => [
        200,
        { matchId: ID(1), unmatchedAt: '2026-11-22T10:00:00.000Z' },
      ],
    });
    const { Wrapper } = wrapper(api);
    const { result } = renderHook(() => ({ list: useMatches(), unmatch: useUnmatch() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.list.matches).toHaveLength(2));
    await act(async () => {
      await result.current.unmatch.mutateAsync(ID(1));
    });
    expect(result.current.list.matches.map((m) => m.matchId)).toContain(ID(2));
    expect(api.calls.find((c) => c.route === 'POST /v1/matches/:id/unmatch')).toBeTruthy();
  });
});

describe('onboarding', () => {
  it('derives the step from the server profile and the confirmed steps', () => {
    const none = new Set();
    expect(nextOnboardingStep(profile({ name: null }), none)).toBe('basics');
    expect(nextOnboardingStep(profile({ gender: null }), none)).toBe('basics');
    expect(nextOnboardingStep(profile({ interestedIn: [] }), none)).toBe('interestedIn');
    expect(nextOnboardingStep(profile(), none)).toBe('ageRange');
    const age = new Set(['ageRange']);
    expect(nextOnboardingStep(profile({ photos: [photo(1)] }), age)).toBe('photos');
    expect(
      nextOnboardingStep(
        profile({ photos: [photo(1), photo(2, 'rejected')] }),
        new Set(['ageRange', 'photos']),
      ),
    ).toBe('photos');
    expect(
      nextOnboardingStep(
        profile({ photos: [photo(1), photo(2, 'pending')] }),
        new Set(['ageRange', 'photos']),
      ),
    ).toBe('done');
  });

  it('progress survives a restart (a new app instance with the same device storage)', async () => {
    const prefs = memoryPrefs();
    const api = fakeApi({ 'GET /v1/me/profile': () => [200, profile()] });
    const first = wrapper(api, { prefs });
    const a = renderHook(() => useOnboarding(), { wrapper: first.Wrapper });
    await waitFor(() => expect(a.result.current.step).toBe('ageRange'));
    await act(async () => {
      await a.result.current.complete('ageRange');
    });
    expect(a.result.current.step).toBe('photos');
    expect(first.tracked).toContain('onboarding_step_completed {"step":"ageRange"}');
    a.unmount();
    const second = wrapper(api, { prefs });
    const b = renderHook(() => useOnboarding(), { wrapper: second.Wrapper });
    await waitFor(() => expect(b.result.current.step).toBe('photos'));
    // Only the step names are stored, under the pseudonymous public id.
    expect(await prefs.get(`vouch.onboarding.${ID(900)}`)).toBe('["ageRange"]');
  });
});

describe('analytics', () => {
  it('records allow-listed properties only, so nothing personal can be logged', () => {
    expect(
      sanitizeProps({ step: 'photos', direction: 'sideways', cards: 3, email: 'a@b.c' }),
    ).toEqual({ step: 'photos', cards: 3 });
    /** @type {string[]} */
    const lines = [];
    const analytics = createLogAnalytics((line) => lines.push(line));
    analytics.track('swipe', { direction: 'like', name: 'Asha' });
    analytics.track(/** @type {any} */ ('made_up'));
    expect(lines).toEqual(['[analytics] swipe {"direction":"like"}']);
  });
});
