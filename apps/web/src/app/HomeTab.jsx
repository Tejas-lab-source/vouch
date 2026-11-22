// @ts-check
import { NotFoundPage } from '../pages/not-found/NotFoundPage.jsx';

/**
 * Renders one `home.tabs` item. A tab whose feature flag is off is not in the tab bar and is
 * treated as missing here.
 * @param {{ item: { id: string, component?: any, props?: Record<string, unknown> } }} props
 */
export function HomeTab({ item }) {
  const Component = item.component;
  return Component ? <Component {...(item.props ?? {})} /> : <NotFoundPage />;
}
