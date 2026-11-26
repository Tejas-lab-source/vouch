// @ts-check
import { useServices, useSession, useSlotItems } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Heart,
  Icon,
  LogOut,
  MessageCircle,
  Settings,
  Toast,
  UserRound,
  Users,
  Wordmark,
} from '@vouch/ui-web';
import { useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router';
import { MatchMomentProvider } from '../../features/match-moment/MatchMoment.jsx';

/** Tab icons by tab id (the tabs themselves come from the `home.tabs` slot). */
const TAB_ICONS = new Map([
  ['discover', Heart],
  ['matches', Users],
  ['chats', MessageCircle],
  ['profile', UserRound],
]);

/**
 * The signed-in shell: the header (wordmark, settings, sign out), the navigation (from the
 * `home.tabs` slot, flag-filtered: a side rail on wide screens, a bottom bar on phones) and
 * the current tab. A banner tells the user when the connection is down.
 */
export function AppShell() {
  const tabs = useSlotItems('home.tabs');
  const { signOut } = useSession();
  const online = useOnline();
  return (
    <div className="w-shell">
      <header className="w-header">
        <NavLink to="/" className="w-header__brand">
          <Wordmark height={30} />
        </NavLink>
        <span className="w-header__actions">
          <NavLink
            to="/settings"
            className="w-header__icon"
            aria-label={t('settings.open')}
            title={t('settings.open')}
          >
            <Icon icon={Settings} />
          </NavLink>
          <button
            type="button"
            className="w-header__icon"
            aria-label={t('common.signOut')}
            title={t('common.signOut')}
            onClick={() => void signOut()}
          >
            <Icon icon={LogOut} />
          </button>
        </span>
      </header>
      <nav className="w-tabs" aria-label={t('nav.main')}>
        {tabs.map((tab) => {
          const glyph = TAB_ICONS.get(tab.id);
          return (
            <NavLink
              key={tab.id}
              to={/** @type {string} */ (tab.props?.path)}
              end={tab.props?.path === '/'}
              className={({ isActive }) => `w-tab${isActive ? ' w-tab--active' : ''}`}
            >
              {glyph ? <Icon icon={glyph} /> : null}
              <span>{t(/** @type {any} */ (tab.props?.labelKey))}</span>
            </NavLink>
          );
        })}
      </nav>
      <main className="w-main" id="main">
        {online ? null : (
          <div className="w-offline">
            <Toast message={t('common.offline')} tone="error" />
          </div>
        )}
        <MatchMomentProvider>
          <Outlet />
        </MatchMomentProvider>
      </main>
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
