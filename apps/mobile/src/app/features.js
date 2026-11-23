// @ts-check
import { createFeatureRegistry, defineClientFeature } from '@vouch/features-core';
import { DiscoverScreen } from '../pages/discover/DiscoverScreen.jsx';
import { TextMessage } from '../entities/message/TextMessage.jsx';
import { ChatsScreen } from '../pages/chats/ChatsScreen.jsx';
import { MatchesScreen } from '../pages/matches/MatchesScreen.jsx';
import { ProfileScreen } from '../pages/profile/ProfileScreen.jsx';

/**
 * The mobile app's client features, each registering its home tab (the ids are the Expo
 * Router tab routes); chat also registers the `text` message renderer.
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
      id: 'chat.conversations',
      slots: {
        'chat.messageRenderers': [{ id: 'text', component: TextMessage, props: { kind: 'text' } }],
        'home.tabs': [
          {
            id: 'chats',
            order: 30,
            component: ChatsScreen,
            props: { labelKey: 'home.tabs.chats' },
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
            component: ProfileScreen,
            props: { labelKey: 'home.tabs.profile' },
          },
        ],
      },
    }),
  ]);
}
