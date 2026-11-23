// @ts-check
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App.jsx';

const panels = {
  items: [
    {
      id: 'safety.reports',
      module: 'safety',
      title: 'Reports',
      roles: ['moderator', 'admin'],
      list: {
        endpoint: 'adminListReports',
        columns: [{ field: 'reason', label: 'Reason', kind: 'text' }],
      },
      detail: null,
      actions: [],
    },
  ],
};

/** @param {{ loginOk: boolean }} options */
const fakeFetch = ({ loginOk }) => {
  /** @type {any[]} */
  const calls = [];
  const impl = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const path = new URL(url).pathname;
      calls.push({ path, auth: init.headers.authorization });
      if (path === '/v1/admin/auth/login') {
        return loginOk
          ? new Response(
              JSON.stringify({
                accessToken: 'adm',
                expiresAt: '2030-01-01T00:00:00Z',
                admin: { displayName: 'Asha', role: 'admin' },
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' } }),
              { status: 401 },
            );
      }
      if (path === '/v1/admin/panels') return new Response(JSON.stringify(panels), { status: 200 });
      return new Response('{}', { status: 404 });
    }
  );
  return { impl, calls };
};

/** @param {string} label @param {string} value */
const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('admin shell', () => {
  it('signs in with email, password and code, then lists the panels for the role', async () => {
    const { impl, calls } = fakeFetch({ loginOk: true });
    render(<App baseUrl="http://localhost" fetch={impl} />);
    type('Staff email', 'asha@staff.example.com');
    type('Password', 'correct horse');
    type('Authenticator code', '12a3456');
    expect(
      /** @type {HTMLInputElement} */ (screen.getByLabelText('Authenticator code')).value,
    ).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.click(await screen.findByRole('button', { name: /Reports/ }));
    expect(await screen.findByRole('region', { name: 'Reports' })).toBeTruthy();
    expect(calls.find((c) => c.path === '/v1/admin/panels')?.auth).toBe('Bearer adm');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('a failed sign-in shows one generic message and clears the code', async () => {
    const { impl } = fakeFetch({ loginOk: false });
    render(<App baseUrl="http://localhost" fetch={impl} />);
    type('Staff email', 'asha@staff.example.com');
    type('Password', 'wrong');
    type('Authenticator code', '000000');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The email, password or code is wrong.',
    );
    expect(
      /** @type {HTMLInputElement} */ (screen.getByLabelText('Authenticator code')).value,
    ).toBe('');
  });
});
