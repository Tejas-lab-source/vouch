// @ts-check
import { describe, expect, it } from 'vitest';
import { monitoringOptions, scrubBreadcrumb, scrubEvent } from '../src/index.js';

describe('error-report scrubbing (Phase 15)', () => {
  it('removes the user, request details, extras and any email or token from messages', () => {
    const event = scrubEvent({
      message: 'failed for aditi@jiit.ac.in with Bearer abc.def.ghi',
      user: { email: 'a@b.co', ip_address: '1.2.3.4' },
      request: {
        url: 'https://app.example.app/chat/123?token=x#y',
        method: 'GET',
        headers: { cookie: 'refresh=1', authorization: 'Bearer t' },
        cookies: { refresh: '1' },
        data: { email: 'a@b.co' },
      },
      extra: { body: 'x' },
      server_name: 'laptop',
      exception: {
        values: [{ type: 'ApiError', value: `token eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.sig` }],
      },
      breadcrumbs: [
        { category: 'console', message: 'aditi@jiit.ac.in' },
        { category: 'ui.click', message: 'button "Aditi"' },
        {
          category: 'fetch',
          data: { url: '/v1/auth/verify?x=1', method: 'POST', status_code: 422, body: 'x' },
        },
        { category: 'navigation', data: { from: '/a?b=1', to: '/c' } },
      ],
    });
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.request).toEqual({ url: 'https://app.example.app/chat/123', method: 'GET' });
    expect(event.message).toBe('failed for [email] with Bearer [token]');
    expect(event.exception.values[0].value).toBe('token [token]');
    expect(event.breadcrumbs).toEqual([
      { category: 'fetch', data: { method: 'POST', status_code: 422, url: '/v1/auth/verify' } },
      { category: 'navigation', data: { from: '/a', to: '/c' } },
    ]);
    expect(JSON.stringify(event)).not.toMatch(/jiit|refresh=|Aditi/);
  });

  it('keeps ordinary breadcrumbs and turns off without a DSN', () => {
    expect(scrubBreadcrumb({ category: 'navigation', message: 'went home' })).toEqual({
      category: 'navigation',
      message: 'went home',
    });
    expect(monitoringOptions({ dsn: '' })).toBeNull();
    const options = monitoringOptions({ dsn: 'https://k@o1.ingest.sentry.io/1', release: 'abc' });
    expect(options).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0, release: 'abc' });
  });
});
