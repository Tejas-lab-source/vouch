// @ts-check
import { createApiClient } from '@vouch/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getPath, pathParams, rowId } from '../src/shared/lib/panels.js';
import { PanelView } from '../src/widgets/panel/PanelView.jsx';

const REPORT = '01936f3e-8a4b-7c2d-9e1f-000000000001';
const panel = /** @type {any} */ ({
  id: 'safety.reports',
  module: 'safety',
  title: 'Reports',
  list: {
    endpoint: 'adminListReports',
    columns: [
      { field: 'reason', label: 'Reason', kind: 'text' },
      { field: 'targetId', label: 'Reported user', kind: 'user' },
    ],
  },
  detail: {
    endpoint: 'adminGetReport',
    fields: [{ field: 'evidence.note', label: 'Note', kind: 'text' }],
  },
  actions: [
    {
      id: 'ban',
      label: 'Ban user',
      endpoint: 'adminActOnReport',
      body: { action: 'ban' },
      needsNote: true,
      confirm: true,
      danger: true,
    },
  ],
});

function setup() {
  /** @type {{ method: string, path: string, body: any }[]} */
  const calls = [];
  let acted = false;
  const fetch = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const u = new URL(url);
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ method: init.method, path: `${u.pathname}${u.search}`, body });
      /** @type {[number, unknown]} */
      let reply = [404, {}];
      if (u.pathname === '/v1/admin/reports')
        reply = [
          200,
          {
            items: [
              {
                reportId: REPORT,
                reason: 'harassment',
                targetId: 'u_target_0000000000000',
                status: 'open',
              },
            ],
            nextCursor: null,
          },
        ];
      if (u.pathname === `/v1/admin/reports/${REPORT}`)
        reply = [200, { evidence: { note: 'rude' } }];
      if (u.pathname === `/v1/admin/reports/${REPORT}/actions`) {
        reply = [200, {}];
        acted = true;
      }
      // The entry is stored from the outbox after the action (ADR 0025): none before it.
      if (u.pathname === '/v1/admin/audit-log')
        reply = [
          200,
          {
            items: !acted
              ? []
              : [
                  {
                    id: 'a1',
                    actorName: 'Asha Admin',
                    action: 'report.ban',
                    targetType: 'report',
                    targetId: REPORT,
                    details: {},
                    createdAt: '2026-11-22T10:00:00.000Z',
                  },
                ],
            nextCursor: null,
          },
        ];
      return new Response(JSON.stringify(reply[1]), {
        status: reply[0],
        headers: { 'content-type': 'application/json' },
      });
    }
  );
  const client = createApiClient({
    baseUrl: 'http://admin',
    appVersion: '1.0.0',
    fetch,
    tokens: { get: () => 't', refresh: () => Promise.reject(new Error('no')) },
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PanelView client={client} panel={panel} />
    </QueryClientProvider>,
  );
  return { calls };
}

describe('generic admin panels', () => {
  it('helpers: dotted paths, the row id convention and path parameters', () => {
    expect(getPath({ evidence: { note: 'x' } }, 'evidence.note')).toBe('x');
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
    expect(rowId({ reportId: 'r', targetId: 't' })).toBe('r');
    expect(rowId({ banId: 'b', userId: 'u' })).toBe('b');
    expect(pathParams('/v1/admin/reports/{id}/actions')).toEqual(['id']);
  });

  it('renders the list from the definition, opens the detail, and an action asks for a note, confirms, then shows its audit entry', async () => {
    const { calls } = setup();
    expect(await screen.findByRole('columnheader', { name: 'Reason' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'harassment' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('rude')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ban user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban user?' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(/** @type {HTMLButtonElement} */ (confirm).disabled).toBe(true); // a note is required
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Note for the audit log' }), {
      target: { value: 'repeated harassment' },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(within(dialog).getByRole('status').textContent).toContain('report.ban on report'),
    );
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: `/v1/admin/reports/${REPORT}/actions`,
      body: { action: 'ban', note: 'repeated harassment' },
    });
  });
});
