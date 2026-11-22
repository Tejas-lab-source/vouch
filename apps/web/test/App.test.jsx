// @ts-check
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App.jsx';
import { createWebRegistry } from '../src/app/features.js';
import { createServices } from '../src/app/services.js';

/** A backend where no one is signed in. */
const signedOutFetch = /** @type {any} */ (
  async (/** @type {string} */ url) => {
    const path = new URL(url).pathname;
    if (path === '/v1/auth/refresh') {
      return new Response(
        JSON.stringify({ error: { code: 'REFRESH_TOKEN_INVALID', message: 'x', requestId: 'r' } }),
        { status: 401 },
      );
    }
    return new Response(JSON.stringify({ flags: {}, privacyNoticeVersion: 'draft' }), {
      status: 200,
    });
  }
);

describe('web app', () => {
  it('without a session it restores silently, then shows sign-in', async () => {
    window.history.pushState({}, '', '/');
    render(
      <App services={createServices({ fetch: signedOutFetch, baseUrl: 'http://localhost' })} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Sign in with your college email' }),
    ).toBeTruthy();
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('registers the four home tabs in order', () => {
    const tabs = createWebRegistry().itemsFor('home.tabs', {});
    expect(tabs.map((t) => t.props?.path)).toEqual(['/', '/matches', '/chats', '/profile']);
  });
});
