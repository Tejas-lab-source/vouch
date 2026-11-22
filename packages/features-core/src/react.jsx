// @ts-check
import { getConfig, keys } from '@vouch/api-client';
import { useQuery } from '@tanstack/react-query';
import { createContext, Fragment, useContext, useMemo, useSyncExternalStore } from 'react';

/**
 * @typedef {object} AppServices  What every screen may use, provided once at the app root.
 * @property {import('@vouch/api-client').ApiClient} client
 * @property {import('@vouch/api-client').Session} session
 * @property {import('./registry.js').FeatureRegistry} registry
 * @property {ReturnType<typeof import('./auth.js').createAuthFlow>} auth
 */

const ServicesContext = createContext(/** @type {AppServices | null} */ (null));

/**
 * Provides the app's services (client, session, registry, auth flow). Server state itself
 * lives only in TanStack Query.
 * @param {{ services: AppServices, children: import('react').ReactNode }} props
 */
export function AppServicesProvider({ services, children }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

/** @returns {AppServices} */
export function useServices() {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside AppServicesProvider');
  return services;
}

/**
 * Whether the user is signed in, re-rendering when the session changes.
 * @returns {{ signedIn: boolean, signOut: () => Promise<void> }}
 */
export function useSession() {
  const { session } = useServices();
  const signedIn = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.accessToken() !== null,
    () => false,
  );
  return useMemo(() => ({ signedIn, signOut: () => session.end() }), [signedIn, session]);
}

/**
 * `GET /v1/config` (flags evaluated for the caller, versions, limits). Refetched when the
 * socket sends `config.changed` (realtime's cache adapter invalidates the key).
 */
export function useConfig() {
  const { client } = useServices();
  const { signedIn } = useSession();
  return useQuery({
    queryKey: [...keys.config(), signedIn],
    queryFn: () => getConfig(client),
    staleTime: 5 * 60 * 1000,
  });
}

/** The evaluated flags (empty until the config loads). @returns {Record<string, boolean>} */
export function useFlags() {
  return useConfig().data?.flags ?? {};
}

/**
 * Renders the items registered for a slot, filtered by the caller's flags. `render` receives
 * each item; the default renders `item.component` with `item.props`.
 * @param {{ name: (typeof import('./registry.js').SLOTS)[number], render?: (item: any) => import('react').ReactNode, fallback?: import('react').ReactNode }} props
 */
export function Slot({ name, render, fallback = null }) {
  const { registry } = useServices();
  const flags = useFlags();
  const items = registry.itemsFor(name, flags);
  if (items.length === 0) return <>{fallback}</>;
  return (
    <>
      {items.map((item) => {
        if (render) return <Fragment key={`${item.feature}:${item.id}`}>{render(item)}</Fragment>;
        const Component = item.component;
        return Component ? (
          <Component key={`${item.feature}:${item.id}`} {...(item.props ?? {})} />
        ) : null;
      })}
    </>
  );
}

/** The slot items as data (for tab bars and menus that lay items out themselves). */
export function useSlotItems(/** @type {(typeof import('./registry.js').SLOTS)[number]} */ name) {
  const { registry } = useServices();
  return registry.itemsFor(name, useFlags());
}
