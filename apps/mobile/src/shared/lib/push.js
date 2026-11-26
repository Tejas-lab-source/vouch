// @ts-check
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { APP_VERSION } from '../config/index.js';

// Show pushes while the app is open too (the server never puts message text in them).
// The design-screenshot web export has no pushes (see secure-storage.js).
const web = Platform.OS === 'web';
if (!web)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

/** @param {string} status @returns {'granted' | 'denied' | 'undetermined'} */
const normalise = (status) =>
  status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';

/**
 * The push port for features-core (`usePushRegistration`): permission and the Expo push token.
 * Simulators have no token (null), which the hook treats as "not available".
 * @type {import('@vouch/features-core').PushPort}
 */
export const expoPush = {
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
  appVersion: APP_VERSION,
  status: async () =>
    web ? 'undetermined' : normalise((await Notifications.getPermissionsAsync()).status),
  request: async () =>
    (await Notifications.requestPermissionsAsync()).status === 'granted' ? 'granted' : 'denied',
  token: async () => {
    if (web || !Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Vouch',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    try {
      return (await Notifications.getExpoPushTokenAsync()).data;
    } catch {
      return null;
    }
  },
};

/** Removes delivered notifications about one conversation (when it is opened). @param {string} conversationId */
export async function clearConversationNotifications(conversationId) {
  if (web) return;
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  for (const n of shown) {
    const data = /** @type {any} */ (n.request.content.data);
    if (data?.conversationId === conversationId) {
      await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
    }
  }
}
