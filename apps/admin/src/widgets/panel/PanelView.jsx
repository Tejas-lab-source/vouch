// @ts-check
import { ENDPOINTS } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Skeleton } from '@vouch/ui-web';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FieldValue } from '../../entities/field/FieldValue.jsx';
import { FlagToggle } from '../../features/flag-toggle/FlagToggle.jsx';
import { ActionButton } from '../../features/panel-action/ActionButton.jsx';
import { getPath, rowId } from '../../shared/lib/panels.js';

/**
 * @typedef {{ field: string, label: string, kind: 'text' | 'timestamp' | 'status' | 'user' | 'image' | 'json' }} PanelField
 * @typedef {{ id: string, module: string, title: string, list: { endpoint: string, columns: PanelField[] }, detail: { endpoint: string, fields: PanelField[] } | null, actions: import('../../features/panel-action/ActionButton.jsx').PanelAction[] }} Panel
 */

/** @param {string} id */
const endpointOf = (id) => new Map(Object.entries(ENDPOINTS)).get(id);

/**
 * Renders any panel from its definition: the list (paged), an optional detail view and the
 * actions on each row. Nothing here knows which module a panel comes from.
 * @param {{ client: import('@vouch/api-client').ApiClient, panel: Panel }} props
 */
export function PanelView({ client, panel }) {
  const list = useInfiniteQuery({
    queryKey: ['admin', 'panel', panel.id],
    initialPageParam: /** @type {string | undefined} */ (undefined),
    queryFn: async ({ pageParam }) => {
      const endpoint = endpointOf(panel.list.endpoint);
      if (!endpoint) throw new Error(`unknown endpoint ${panel.list.endpoint}`);
      return /** @type {{ items: Record<string, unknown>[], nextCursor?: string | null }} */ (
        await client.call(endpoint, pageParam ? { query: { cursor: pageParam } } : {})
      );
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const refresh = () => void list.refetch();

  return (
    <section aria-labelledby="panel-title">
      <div className="a-row a-row--between">
        <h1 id="panel-title">{panel.title}</h1>
        <Button variant="ghost" onClick={refresh}>
          {t('admin.panel.refresh')}
        </Button>
      </div>
      {list.isPending ? <Skeleton height={120} /> : null}
      {list.isError ? <EmptyState title={t('common.error')} /> : null}
      {list.isSuccess && rows.length === 0 ? <EmptyState title={t('admin.panel.empty')} /> : null}
      {rows.length > 0 ? (
        <table className="a-table">
          <thead>
            <tr>
              {panel.list.columns.map((c) => (
                <th key={c.field} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col">
                <span className="v-visually-hidden">{t('admin.panel.details')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const id = rowId(row) ?? String(getPath(row, 'key') ?? i);
              return (
                <tr key={id}>
                  {panel.list.columns.map((c) => (
                    <td key={c.field}>
                      <FieldValue value={getPath(row, c.field)} kind={c.kind} label={c.label} />
                    </td>
                  ))}
                  <td className="a-actions">
                    {panel.detail ? (
                      <Button variant="ghost" onClick={() => setOpenId(openId === id ? null : id)}>
                        {openId === id ? t('admin.panel.close') : t('admin.panel.open')}
                      </Button>
                    ) : null}
                    {panel.actions.map((a) => (
                      <ActionButton
                        key={a.id}
                        client={client}
                        action={a}
                        row={row}
                        onDone={refresh}
                      />
                    ))}
                    {panel.id === 'admin.flags' ? (
                      <FlagToggle
                        client={client}
                        flag={/** @type {any} */ (row)}
                        onDone={refresh}
                      />
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('admin.panel.more')}
        </Button>
      ) : null}
      {openId && panel.detail ? <Detail client={client} panel={panel} id={openId} /> : null}
    </section>
  );
}

/** @param {{ client: import('@vouch/api-client').ApiClient, panel: Panel, id: string }} props */
function Detail({ client, panel, id }) {
  const detail = /** @type {NonNullable<Panel['detail']>} */ (panel.detail);
  const query = useQuery({
    queryKey: ['admin', 'detail', panel.id, id],
    queryFn: async () => {
      const endpoint = endpointOf(detail.endpoint);
      if (!endpoint) throw new Error(`unknown endpoint ${detail.endpoint}`);
      return client.call(endpoint, { params: { id } });
    },
  });
  return (
    <section className="a-detail" aria-label={t('admin.panel.details')}>
      <h2>{t('admin.panel.details')}</h2>
      {query.isPending ? <Skeleton height={80} /> : null}
      {query.data ? (
        <dl>
          {detail.fields.map((f) => (
            <div key={f.field} className="a-detail__row">
              <dt>{f.label}</dt>
              <dd>
                <FieldValue value={getPath(query.data, f.field)} kind={f.kind} label={f.label} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
