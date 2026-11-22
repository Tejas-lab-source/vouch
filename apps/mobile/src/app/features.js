// @ts-check
import { createFeatureRegistry, defineClientFeature } from '@vouch/features-core';
import { DiscoverScreen } from '../pages/discover/DiscoverScreen.jsx';
import { ComingSoon } from '../pages/home/ComingSoon.jsx';
import { MatchesScreen } from '../pages/matches/MatchesScreen.jsx';
import { ProfileScreen } from '../pages/profile/ProfileScreen.jsx';

/**
 * The mobile app's client features, each registering its home tab (the ids are the Expo
 * Router tab routes). Chats is a placeholder until Phase 13.
 */
export function createMobileRegistry() {
  return createFeatureRegistry([
    defineClientFeature({
      id: 'discovery.deck',
      slots: {
        'home.tabs': [
          {
            id: 'index',
            order: 10,
            component: DiscoverScreen,
            props: { labelKey: 'home.tabs.discover' },
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
            component: MatchesScreen,
            props: { labelKey: 'home.tabs.matches' },
          },
        ],
      },
    }),
    defineClientFeature({
      id: 'core.chats',
      slots: {
        'home.tabs': [
          { id: 'chats', order: 30, component: ComingSoon, props: { labelKey: 'home.tabs.chats' } },
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
            component: ProfileScreen,
            props: { labelKey: 'home.tabs.profile' },
          },
        ],
      },
    }),
  ]);
}
