// @ts-check
import { adminListPanels } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button, EmptyState, ListItem, Skeleton } from '@vouch/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * The panel renderer skeleton (Phase 11): the panels this staff member may use, from
 * `GET /v1/admin/panels`. Phase 13 renders each panel's list, detail and actions generically.
 * @param {{ client: import('@vouch/api-client').ApiClient, staff: { displayName: string, role: string }, onSignOut: () => void }} props
 */
export function PanelsPage({ client, staff, onSignOut }) {
  const panels = useQuery({
    queryKey: ['admin', 'panels'],
    queryFn: () => adminListPanels(client),
  });
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const panel = panels.data?.items.find((/** @type {any} */ p) => p.id === selected) ?? null;
  return (
    <div className="a-shell">
      <header className="a-header">
        <strong>{t('admin.title')}</strong>
        <span>
          {staff.displayName} ({staff.role})
        </span>
        <Button variant="ghost" onClick={onSignOut}>
          {t('common.signOut')}
        </Button>
      </header>
      <nav className="a-nav" aria-label={t('admin.panels.title')}>
        {panels.isPending ? <Skeleton height={44} /> : null}
        {panels.data?.items.length === 0 ? <p>{t('admin.panels.empty')}</p> : null}
        {panels.data?.items.map((/** @type {any} */ p) => (
          <ListItem
            key={p.id}
            title={p.title}
            subtitle={p.module}
            onClick={() => setSelected(p.id)}
          />
        ))}
      </nav>
      <main className="a-main">
        {panel ? (
          <section aria-label={panel.title}>
            <h1>{panel.title}</h1>
            <p>{t('admin.panels.soon')}</p>
            <p>{panel.list.columns.map((/** @type {any} */ c) => c.label).join(' · ')}</p>
          </section>
        ) : (
          <EmptyState title={t('admin.panels.title')} />
        )}
      </main>
    </div>
  );
}
