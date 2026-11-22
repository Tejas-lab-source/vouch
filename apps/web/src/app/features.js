// @ts-check
import { createFeatureRegistry, defineClientFeature } from '@vouch/features-core';
import { ComingSoon } from '../pages/home/ComingSoon.jsx';
import { DiscoverPage } from '../pages/discover/DiscoverPage.jsx';
import { MatchesPage } from '../pages/matches/MatchesPage.jsx';
import { ProfilePage } from '../pages/profile/ProfilePage.jsx';

/**
 * The web app's client features, each registering its home tab. Chats is a placeholder until
 * Phase 13 registers the chat feature.
 */
export function createWebRegistry() {
  return createFeatureRegistry([
    defineClientFeature({
      id: 'discovery.deck',
      slots: {
        'home.tabs': [
          {
            id: 'discover',
            order: 10,
            component: DiscoverPage,
            props: { path: '/', labelKey: 'home.tabs.discover' },
          },
        ],
      },
    }),
    defineClientFeature({
      id: 'matching.matches',
      slots: {
        'home.tabs': [
          {
            id: 'matches',
            order: 20,
            component: MatchesPage,
            props: { path: '/matches', labelKey: 'home.tabs.matches' },
          },
        ],
      },
    }),
    defineClientFeature({
      id: 'core.chats',
      slots: {
        'home.tabs': [
          {
            id: 'chats',
            order: 30,
            component: ComingSoon,
            props: { path: '/chats', labelKey: 'home.tabs.chats' },
          },
        ],
      },
    }),
    defineClientFeature({
      id: 'profiles.profile',
      slots: {
        'home.tabs': [
          {
            id: 'profile',
            order: 40,
            component: ProfilePage,
            props: { path: '/profile', labelKey: 'home.tabs.profile' },
          },
        ],
      },
    }),
  ]);
}
