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
