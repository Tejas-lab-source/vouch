// @ts-check
import { AppServicesProvider, useSession, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Skeleton } from '@vouch/ui-web';
import { QueryClientProvider } from '@tanstack/react-query';
import { Component, lazy, Suspense, useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { HomeTab } from './HomeTab.jsx';
import { NotFoundPage } from '../pages/not-found/NotFoundPage.jsx';
import { SignInPage } from '../pages/sign-in/SignInPage.jsx';
import { AppShell } from '../widgets/app-shell/AppShell.jsx';

const UiKitPage = lazy(() => import('../pages/ui-kit/UiKitPage.jsx'));

/** Catches render errors anywhere below and shows a recoverable screen. */
export class ErrorBoundary extends Component {
  /** @param {{ children: import('react').ReactNode }} props */
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <main className="w-page">
          <EmptyState
            title={t('error.title')}
            body={t('error.body')}
            action={
              <Button onClick={() => globalThis.location.reload()}>{t('common.retry')}</Button>
            }
          />
        </main>
      );
    }
    return /** @type {any} */ (this.props).children;
  }
}

/**
 * Restores the session once at start-up from the refresh cookie (a silent refresh), so a
 * signed-in user does not see the sign-in screen flash.
 * @param {{ children: import('react').ReactNode }} props
 */
function SessionRestore({ children }) {
  const { session } = useServices();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    session
      .refresh()
      .catch(() => {})
      .finally(() => setReady(true));
  }, [session]);
  if (!ready) {
    return (
      <main className="w-page" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton height={32} />
      </main>
    );
  }
  return <>{children}</>;
}

/** Signed-in routes. */
function RequireSession() {
  const { signedIn } = useSession();
  return signedIn ? <AppShell /> : <Navigate to="/sign-in" replace />;
}

/** The sign-in route (signed-in users go home). */
function SignInRoute() {
  const { signedIn } = useSession();
  return signedIn ? <Navigate to="/" replace /> : <SignInPage />;
}

/** @param {import('./services.js').WebServices} services */
export function createRouter(services) {
  const tabs = services.registry.itemsFor('home.tabs', {});
  return createBrowserRouter([
    {
      element: <Outlet />,
      errorElement: <NotFoundPage />,
      children: [
        { path: '/sign-in', element: <SignInRoute /> },
        {
          path: '/ui-kit',
          element: (
            <Suspense fallback={<Skeleton height={32} />}>
              <UiKitPage />
            </Suspense>
          ),
        },
        {
          element: <RequireSession />,
          children: tabs.map((tab) => ({
            path: /** @type {string} */ (tab.props?.path),
            element: <HomeTab item={tab} />,
          })),
        },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ]);
}

/** @param {{ services: import('./services.js').WebServices }} props */
export function App({ services }) {
  const [router] = useState(() => createRouter(services));
  return (
    <ErrorBoundary>
      <QueryClientProvider client={services.queryClient}>
        <AppServicesProvider services={services}>
          <SessionRestore>
            <RouterProvider router={router} />
          </SessionRestore>
        </AppServicesProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
