// @ts-check
import { useServices, useSession, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Toast } from '@vouch/ui-web';
import { useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router';
import { MatchMomentProvider } from '../../features/match-moment/MatchMoment.jsx';

/**
 * The signed-in shell: the header, the tab bar (from the `home.tabs` slot, flag-filtered) and
 * the current tab. A banner tells the user when the realtime connection is down.
 */
export function AppShell() {
  const tabs = useSlotItems('home.tabs');
  const { signOut } = useSession();
  const online = useOnline();
  return (
    <div className="w-shell">
      <header className="w-header">
        <span className="w-brand w-brand--small">{t('app.name')}</span>
        <span className="w-row">
          <NavLink to="/settings" className="w-header__link">
            {t('settings.open')}
          </NavLink>
          <Button variant="ghost" onClick={() => void signOut()}>
            {t('common.signOut')}
          </Button>
        </span>
      </header>
      {online ? null : <Toast message={t('common.offline')} />}
      <main className="w-main" id="main">
        <MatchMomentProvider>
          <Outlet />
        </MatchMomentProvider>
      </main>
      <nav className="w-tabs" aria-label="Main">
        {tabs.map((tab) => (
          <NavLink
            key={tab.id}
            to={/** @type {string} */ (tab.props?.path)}
            end
            className={({ isActive }) => `w-tab${isActive ? ' w-tab--active' : ''}`}
          >
            {t(/** @type {any} */ (tab.props?.labelKey))}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Whether the browser is online (for the offline banner). */
function useOnline() {
  useServices();
  return useSyncExternalStore(
    (onChange) => {
      globalThis.addEventListener('online', onChange);
      globalThis.addEventListener('offline', onChange);
      return () => {
        globalThis.removeEventListener('online', onChange);
        globalThis.removeEventListener('offline', onChange);
      };
    },
    () => globalThis.navigator.onLine,
    () => true,
  );
}
