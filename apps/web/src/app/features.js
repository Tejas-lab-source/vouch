// @ts-check
import { createFeatureRegistry, defineClientFeature } from '@vouch/features-core';
import { ComingSoon } from '../pages/home/ComingSoon.jsx';

/**
 * The web app's client features. Phase 11 registers the four home tabs as placeholders;
 * Phases 12–13 replace them with the real screens (new features, no edits to the shell).
 */
export function createWebRegistry() {
  return createFeatureRegistry([
    defineClientFeature({
      id: 'core.tabs',
      slots: {
        'home.tabs': [
          {
            id: 'discover',
            order: 10,
            component: ComingSoon,
            props: { path: '/', labelKey: 'home.tabs.discover' },
          },
          {
            id: 'matches',
            order: 20,
            component: ComingSoon,
            props: { path: '/matches', labelKey: 'home.tabs.matches' },
          },
          {
            id: 'chats',
            order: 30,
            component: ComingSoon,
            props: { path: '/chats', labelKey: 'home.tabs.chats' },
          },
          {
            id: 'profile',
            order: 40,
            component: ComingSoon,
            props: { path: '/profile', labelKey: 'home.tabs.profile' },
          },
        ],
      },
    }),
  ]);
}
