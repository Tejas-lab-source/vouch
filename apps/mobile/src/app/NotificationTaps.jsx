// @ts-check
import { notificationTarget, usePushRegistration } from '@vouch/features-core';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

/**
 * Signed-in only: registers the push token when permission was already granted, and opens the
 * right screen when a notification is tapped (also the one that launched the app).
 */
export function NotificationTaps() {
  const router = useRouter();
  usePushRegistration();
  useEffect(() => {
    /** @param {Notifications.NotificationResponse | null} response */
    const open = (response) => {
      if (!response) return;
      const target = notificationTarget(response.notification.request.content.data);
      if (target.screen === 'chat') router.push(`/chat/${target.conversationId}`);
      else if (target.screen === 'matches') router.push('/(tabs)/matches');
      else router.push('/(tabs)');
    };
    void Notifications.getLastNotificationResponseAsync()
      .then(open)
      .catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);
  return null;
}
