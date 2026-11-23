// @ts-check
import { createApiClient, createSession } from '@vouch/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AppServicesProvider,
  createAuthFlow,
  createFeatureRegistry,
  defineClientFeature,
  errorKey,
  Slot,
  useSession,
} from '../src/index.js';

/** A fake API answering by "METHOD path". @param {Record<string, (body: any) => [number, unknown]>} routes */
const fakeFetch = (routes) =>
  /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const handler = new Map(Object.entries(routes)).get(
        `${init.method} ${new URL(url).pathname}`,
      );
      const [status, body] = handler
        ? handler(init.body ? JSON.parse(init.body) : undefined)
        : [404, {}];
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
  );

/** @param {Record<string, boolean>} flags */
function setup(flags, extraRoutes = {}) {
  const fetch = fakeFetch({ 'GET /v1/config': () => [200, { flags }], ...extraRoutes });
  const session = createSession({
    transport: 'cookie',
    baseUrl: 'http://api',
    appVersion: '1.0.0',
    fetch,
  });
  const client = createApiClient({
    baseUrl: 'http://api',
    appVersion: '1.0.0',
    fetch,
    tokens: { get: () => session.accessToken(), refresh: () => session.refresh() },
  });
  const auth = createAuthFlow({
    client,
    session,
    platform: 'web',
    appVersion: '1.0.0',
    captchaToken: async () => 'dev',
  });
  const Tab = (/** @type {{ label: string }} */ { label }) => <span>{label}</span>;
  const registry = createFeatureRegistry([
    defineClientFeature({
      id: 'core.tabs',
      slots: {
        'home.tabs': [
          { id: 'b', order: 20, component: Tab, props: { label: 'second' } },
          { id: 'a', order: 10, component: Tab, props: { label: 'first' } },
        ],
      },
    }),
    defineClientFeature({
      id: 'beta.tab',
      flag: 'beta.tab',
      slots: { 'home.tabs': [{ id: 'c', order: 15, component: Tab, props: { label: 'flagged' } }] },
    }),
  ]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  /** @param {{ children: import('react').ReactNode }} props */
  const Wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={{ client, session, registry, auth }}>
        {children}
      </AppServicesProvider>
    </QueryClientProvider>
  );
  return { Wrapper, session, auth };
}

describe('feature registry and slots', () => {
  it('a flagged feature renders only when its flag is on, in order', async () => {
    const off = setup({});
    const first = render(
      <off.Wrapper>
        <Slot name="home.tabs" />
      </off.Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/first|second|flagged/).map((n) => n.textContent)).toEqual([
        'first',
        'second',
      ]),
    );
    first.unmount();
    const on = setup({ 'beta.tab': true });
    render(
      <on.Wrapper>
        <Slot name="home.tabs" />
      </on.Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/first|second|flagged/).map((n) => n.textContent)).toEqual([
        'first',
        'flagged',
        'second',
      ]),
    );
  });

  it('refuses unknown slots, bad ids and duplicates', () => {
    expect(() =>
      defineClientFeature({ id: 'x.y', slots: /** @type {any} */ ({ 'home.nope': [] }) }),
    ).toThrow(/unknown slot/);
    expect(() => defineClientFeature({ id: 'Bad Id', slots: {} })).toThrow(/bad feature id/);
    const f = defineClientFeature({ id: 'a.b', slots: {} });
    expect(() => createFeatureRegistry([f, f])).toThrow(/duplicate/);
  });

  it('renders a fallback for an empty slot', () => {
    const { Wrapper } = setup({});
    render(
      <Wrapper>
        <Slot name="settings.rows" fallback={<p>none</p>} />
      </Wrapper>,
    );
    expect(screen.getByText('none')).toBeTruthy();
  });
});

describe('sign-in flow', () => {
  const tokens = {
    accessToken: 'acc',
    accessTokenExpiresAt: '2030-01-01T00:00:00Z',
    refreshTokenExpiresAt: '2030-02-01T00:00:00Z',
  };

  it('email → code → signed in; a new account first asks for details; useSession follows', async () => {
    let calls = 0;
    const { Wrapper, auth } = setup(
      {},
      {
        'POST /v1/auth/otp': () => [200, { sent: true }],
        'POST /v1/auth/verify': (/** @type {any} */ body) =>
          body.signup
            ? [
                200,
                {
                  tokens,
                  user: { userId: 'aB3dE5fG7hJ9kL1mN3pQ5r', status: 'active', newUser: true },
                },
              ]
            : (calls++,
              [422, { error: { code: 'SIGNUP_DETAILS_REQUIRED', message: 'x', requestId: 'r' } }]),
      },
    );
    const Probe = () => <p>{useSession().signedIn ? 'in' : 'out'}</p>;
    render(
      <Wrapper>
        <Probe />
      </Wrapper>,
    );
    expect(screen.getByText('out')).toBeTruthy();
    expect(await auth.requestCode('a@college.edu')).toEqual({
      step: 'codeSent',
      email: 'a@college.edu',
    });
    expect(await auth.verify({ email: 'a@college.edu', code: '123456' })).toEqual({
      step: 'needsDetails',
      email: 'a@college.edu',
      code: '123456',
    });
    let state;
    await act(async () => {
      state = await auth.verify({
        email: 'a@college.edu',
        code: '123456',
        signup: {
          birthDate: '2005-01-31',
          consent: { noticeVersion: 'draft', purposes: ['matching'] },
        },
      });
    });
    expect(state).toEqual({ step: 'signedIn' });
    expect(calls).toBe(1);
    expect(screen.getByText('in')).toBeTruthy();
  });

  it('maps server errors to i18n keys', async () => {
    const { auth } = setup(
      {},
      {
        'POST /v1/auth/verify': () => [
          400,
          { error: { code: 'OTP_INVALID', message: 'x', requestId: 'r' } },
        ],
      },
    );
    const error = await auth.verify({ email: 'a@college.edu', code: '000000' }).catch((e) => e);
    expect(errorKey(error)).toBe('auth.code.invalid');
    expect(errorKey(new Error('boom'))).toBe('common.error');
  });
});
