// @ts-check
import { registerDevice } from '@vouch/api-client';
import { useCallback, useEffect, useRef } from 'react';
import { useServices } from '../react.jsx';

/**
 * @typedef {object} PushPort  The platform's push notifications (mobile: expo-notifications).
 * @property {() => Promise<'granted' | 'denied' | 'undetermined'>} status
 * @property {() => Promise<'granted' | 'denied'>} request  Shows the system prompt.
 * @property {() => Promise<string | null>} token  The Expo push token (null on simulators).
 * @property {'ios' | 'android'} platform
 * @property {string} appVersion
 */

/**
 * Asks for push permission at a sensible moment (after the first match, never at install) and
 * registers the token with `POST /v1/devices`. `askNow()` asks once; a denial is respected
 * (the settings screen explains how to turn pushes on later). Registration repeats on each
 * start when permission is granted, so a rotated token is picked up.
 */
export function usePushRegistration() {
  const { client, push } = /** @type {any} */ (useServices());
  const registered = useRef(false);

  const register = useCallback(async () => {
    if (!push || registered.current) return false;
    const token = await push.token();
    if (!token) return false;
    await registerDevice(client, {
      body: { pushToken: token, platform: push.platform, appVersion: push.appVersion },
    });
    registered.current = true;
    return true;
  }, [client, push]);

  useEffect(() => {
    if (!push) return;
    void push
      .status()
      .then((/** @type {string} */ s) => (s === 'granted' ? register() : false))
      .catch(() => {});
  }, [push, register]);

  const askNow = useCallback(async () => {
    if (!push) return 'unavailable';
    const current = await push.status();
    if (current === 'denied') return 'denied';
    const answer = current === 'granted' ? 'granted' : await push.request();
    if (answer === 'granted') await register().catch(() => false);
    return answer;
  }, [push, register]);

  return { askNow, available: Boolean(push) };
}

/**
 * Where a notification tap goes, from the push `data` the server sends (no message text is
 * ever in it). Unknown or malformed data opens the home screen.
 * @param {unknown} data
 * @returns {{ screen: 'chat', conversationId: string } | { screen: 'matches' } | { screen: 'discover' } | { screen: 'home' }}
 */
export function notificationTarget(data) {
  const fields = new Map(Object.entries(data && typeof data === 'object' ? data : {}));
  const type = fields.get('type');
  const conversationId = fields.get('conversationId');
  const valid = typeof conversationId === 'string' && /^[0-9a-f-]{36}$/.test(conversationId);
  if ((type === 'message.new' || type === 'match.new') && valid) {
    return { screen: 'chat', conversationId: /** @type {string} */ (conversationId) };
  }
  if (type === 'match.new') return { screen: 'matches' };
  if (type === 'likes.digest') return { screen: 'discover' };
  return { screen: 'home' };
}
