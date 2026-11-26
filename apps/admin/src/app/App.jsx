// @ts-check
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { createStaffSession } from '../features/admin-auth/staff-session.js';
import { LoginPage } from '../pages/login/LoginPage.jsx';
import { PanelsPage } from '../pages/panels/PanelsPage.jsx';
import { API_BASE } from '../shared/config/index.js';

/** @param {{ baseUrl?: string, fetch?: typeof fetch }} props */
export function App({ baseUrl = API_BASE || globalThis.location.origin, fetch }) {
  const [session] = useState(() => createStaffSession({ baseUrl, fetch }));
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const staff = useSyncExternalStore(session.subscribe, session.staff, session.staff);
  return (
    <QueryClientProvider client={queryClient}>
      {staff ? (
        <PanelsPage
          client={session.client}
          staff={staff}
          onSignOut={() => {
            void session.signOut().then(() => queryClient.clear());
          }}
        />
      ) : (
        <LoginPage onSignIn={session.signIn} />
      )}
    </QueryClientProvider>
  );
}
