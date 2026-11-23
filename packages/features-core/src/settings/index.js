// @ts-check
import {
  deleteAccount,
  exportData,
  getNotificationPrefs,
  listDevices,
  listMyBlocks,
  logout,
  putNotificationPrefs,
  revokeDevice,
  unblockUser,
} from '@vouch/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../react.jsx';

const PREFS = /** @type {const} */ (['vouch', 'notification-prefs']);
const BLOCKS = /** @type {const} */ (['vouch', 'blocks']);

/**
 * @typedef {{ pushMatches: boolean, pushMessages: boolean, pushLikesDigest: boolean, quietHours: { startMinute: number, endMinute: number } | null, timezone: string }} NotificationPrefs
 */

/** Push preferences and quiet hours. */
export function useNotificationPrefs() {
  const { client } = useServices();
  return useQuery({
    queryKey: PREFS,
    queryFn: async () => /** @type {NotificationPrefs} */ (await getNotificationPrefs(client)),
  });
}

/** Saves push preferences (the full set; the server validates the time zone). */
export function useUpdateNotificationPrefs() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {NotificationPrefs} body */
    mutationFn: (body) => putNotificationPrefs(client, { body }),
    onSuccess: (prefs) => queryClient.setQueryData(PREFS, prefs),
  });
}

/** "HH:MM" ↔ minutes after midnight, for quiet-hours inputs. */
export const minutesToTime = (/** @type {number} */ m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** @param {string} value @returns {number | null} */
export function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  return h < 24 && m < 60 ? h * 60 + m : null;
}

/** The people I blocked. */
export function useBlockedUsers() {
  const { client } = useServices();
  return useQuery({
    queryKey: BLOCKS,
    queryFn: async () =>
      /** @type {{ userId: string, name: string | null, blockedAt: string }[]} */ (
        (await listMyBlocks(client)).items
      ),
  });
}

/** Unblock someone (they leave the list at once; ended matches stay ended). */
export function useUnblock() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {string} userId */
    mutationFn: (userId) => unblockUser(client, { params: { userId } }),
    onSuccess: (_r, userId) =>
      queryClient.setQueryData(BLOCKS, (/** @type {any[] | undefined} */ list) =>
        list?.filter((b) => b.userId !== userId),
      ),
  });
}

/** My data export (DPDP access right), as the JSON the API returns. */
export function useExportData() {
  const { client } = useServices();
  return useMutation({ mutationFn: () => exportData(client) });
}

/**
 * Account actions: log out (this device), log out of every device (revoke the others, then this
 * one), and delete the account (signed out everywhere; erased within 30 days).
 */
export function useAccountActions() {
  const { client, session, queryClient } = /** @type {any} */ (useServices());
  const cache = useQueryClient();
  const endHere = async () => {
    await session.end();
    (queryClient ?? cache).clear();
  };
  const signOut = useMutation({
    mutationFn: async () => {
      await logout(client, { body: {} }).catch(() => {});
      await endHere();
    },
  });
  const signOutEverywhere = useMutation({
    mutationFn: async () => {
      const { items } = await listDevices(client);
      for (const device of items) {
        if (!device.current) await revokeDevice(client, { params: { id: device.id } });
      }
      await logout(client, { body: {} }).catch(() => {});
      await endHere();
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      await deleteAccount(client);
      await endHere();
    },
  });
  return { signOut, signOutEverywhere, deleteAccount: remove };
}
