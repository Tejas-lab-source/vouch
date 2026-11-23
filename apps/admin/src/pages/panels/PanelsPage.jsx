// @ts-check
import { adminListPanels } from '@vouch/api-client';
import { t } from '@vouch/i18n';
import { Button, EmptyState, ListItem, Skeleton } from '@vouch/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { UserLookup } from '../../features/user-lookup/UserLookup.jsx';
import { PanelView } from '../../widgets/panel/PanelView.jsx';

const LOOKUP = 'users.lookup';

/**
 * The console: the panels this staff member may use (`GET /v1/admin/panels`, filtered by role
 * on the server), each rendered generically, plus user lookup.
 * @param {{ client: import('@vouch/api-client').ApiClient, staff: { displayName: string, role: 'moderator' | 'admin' }, onSignOut: () => void }} props
 */
export function PanelsPage({ client, staff, onSignOut }) {
  const panels = useQuery({
    queryKey: ['admin', 'panels'],
    queryFn: () => adminListPanels(client),
  });
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const items = /** @type {import('../../widgets/panel/PanelView.jsx').Panel[]} */ (
    panels.data?.items ?? []
  );
  const panel = items.find((p) => p.id === selected) ?? null;
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
        {panels.isSuccess && items.length === 0 ? <p>{t('admin.panels.empty')}</p> : null}
        {items.map((p) => (
          <ListItem
            key={p.id}
            title={p.title}
            subtitle={p.module}
            onClick={() => setSelected(p.id)}
          />
        ))}
        <ListItem
          title={t('admin.users.title')}
          subtitle="identity"
          onClick={() => setSelected(LOOKUP)}
        />
      </nav>
      <main className="a-main">
        {selected === LOOKUP ? <UserLookup client={client} role={staff.role} /> : null}
        {panel ? <PanelView key={panel.id} client={client} panel={panel} /> : null}
        {!panel && selected !== LOOKUP ? <EmptyState title={t('admin.panels.choose')} /> : null}
      </main>
    </div>
  );
}
