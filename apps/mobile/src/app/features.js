// @ts-check
import { createFeatureRegistry, defineClientFeature } from '@vouch/features-core';
import { ComingSoon } from '../pages/home/ComingSoon.jsx';

/** The mobile app's client features: the four home tabs (placeholders until Phase 12). */
export function createMobileRegistry() {
  return createFeatureRegistry([
    defineClientFeature({
      id: 'core.tabs',
      slots: {
        'home.tabs': [
          {
            id: 'index',
            order: 10,
            component: ComingSoon,
            props: { labelKey: 'home.tabs.discover' },
          },
          {
            id: 'matches',
            order: 20,
            component: ComingSoon,
            props: { labelKey: 'home.tabs.matches' },
          },
          { id: 'chats', order: 30, component: ComingSoon, props: { labelKey: 'home.tabs.chats' } },
          {
            id: 'profile',
            order: 40,
            component: ComingSoon,
            props: { labelKey: 'home.tabs.profile' },
          },
        ],
      },
    }),
  ]);
}
