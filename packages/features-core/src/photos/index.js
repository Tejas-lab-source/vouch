// @ts-check
import {
  ApiError,
  confirmUpload,
  createUpload,
  deleteMyPhoto,
  getMyProfile,
  keys,
  reorderMyPhotos,
} from '@vouch/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useServices } from '../react.jsx';

/** Photos are resized on the client to at most this many pixels on the long edge (owner). */
export const MAX_EDGE = 2048;

/**
 * The size that fits `width × height` within `max` on the long edge, keeping the aspect ratio.
 * Never upscales.
 * @param {number} width @param {number} height @param {number} [max]
 */
export function fitWithin(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * @typedef {object} PreparedImage
 * @property {any} body  What `put` sends (a Blob on web and mobile).
 * @property {'image/jpeg' | 'image/png' | 'image/webp'} contentType
 * @property {number} sizeBytes
 *
 * @typedef {object} PhotoIo  The platform parts of an upload.
 * @property {(file: any) => Promise<PreparedImage>} prepare  Resize to `MAX_EDGE` and re-encode
 *   (which also strips EXIF, including location).
 * @property {(request: { url: string, headers: Record<string, string>, body: any, onProgress: (fraction: number) => void, signal?: AbortSignal }) => Promise<void>} put
 *
 * @typedef {'preparing' | 'uploading' | 'confirming' | 'processing' | 'approved' | 'rejected' | 'pending' | 'failed'} UploadPhase
 *   `pending`: still being reviewed when polling stopped (the profile shows it as pending).
 * @typedef {{ phase: UploadPhase, progress: number, photoId: string | null, error: unknown }} UploadState
 */

/** Headers a browser sets itself and refuses from scripts. */
const BROWSER_HEADERS = new Set(['content-length', 'host']);

/**
 * `PUT` with upload progress through `XMLHttpRequest` (web and React Native both have it; fetch
 * reports no upload progress).
 * @type {PhotoIo['put']}
 */
export function xhrPut({ url, headers, body, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) {
      if (!BROWSER_HEADERS.has(name.toLowerCase())) xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new ApiError({ code: 'UPLOAD_FAILED', message: 'Upload failed.', status: xhr.status }),
          );
    xhr.onerror = () =>
      reject(new ApiError({ code: 'NETWORK', message: 'Network error.', status: 0 }));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
}

/**
 * One photo upload: prepare → presign → PUT (with progress) → confirm → poll the profile until
 * the photo is approved or rejected. Resumable: a failure after the PUT retries only the
 * confirm (idempotent on the upload id); earlier failures start again with a new presign.
 * @param {{
 *   client: import('@vouch/api-client').ApiClient,
 *   io: PhotoIo,
 *   file: any,
 *   onState: (state: UploadState) => void,
 *   resume?: { uploadId: string } | null,
 *   pollMs?: number,
 *   pollTimeoutMs?: number,
 *   sleep?: (ms: number) => Promise<void>,
 *   onProfile?: (profile: Awaited<ReturnType<typeof getMyProfile>>) => void,
 * }} options
 * @returns {Promise<{ state: UploadState, uploadId: string | null }>}
 */
export async function uploadPhoto({
  client,
  io,
  file,
  onState,
  resume = null,
  pollMs = 1000,
  pollTimeoutMs = 60_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProfile = () => {},
}) {
  /** @type {UploadState} */
  let state = { phase: 'preparing', progress: 0, photoId: null, error: null };
  /** @param {Partial<UploadState>} next */
  const set = (next) => {
    state = { ...state, ...next };
    onState(state);
  };
  let uploadId = resume?.uploadId ?? null;
  try {
    if (!uploadId) {
      set({ phase: 'preparing' });
      const image = await io.prepare(file);
      const target = await createUpload(client, {
        body: { contentType: image.contentType, sizeBytes: image.sizeBytes },
      });
      set({ phase: 'uploading', progress: 0 });
      await io.put({
        url: target.url,
        headers: target.headers,
        body: image.body,
        onProgress: (progress) => set({ progress }),
      });
      uploadId = target.uploadId;
      set({ progress: 1 });
    }
    set({ phase: 'confirming' });
    const confirmed = await confirmUpload(client, { params: { id: uploadId }, body: {} });
    set({ photoId: uploadId });
    if (confirmed.status !== 'processing') {
      set({ phase: confirmed.status });
      return { state, uploadId };
    }
    set({ phase: 'processing' });
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const profile = await getMyProfile(client);
      onProfile(profile);
      const photo = profile.photos.find(
        (/** @type {{ id: string, status: string }} */ p) => p.id === uploadId,
      );
      if (photo && photo.status !== 'pending') {
        set({ phase: photo.status });
        return { state, uploadId };
      }
    }
    set({ phase: 'pending' });
    return { state, uploadId };
  } catch (error) {
    set({ phase: 'failed', error });
    return { state, uploadId };
  }
}

/**
 * Uploads several photos with per-photo state (`uploads`), retry and dismiss. The profile cache
 * is refreshed as photos land.
 */
export function usePhotoUploads() {
  const {
    client,
    photoIo,
    newId = () => /** @type {any} */ (globalThis).crypto.randomUUID(),
  } = useServices();
  const queryClient = useQueryClient();
  /** @type {[Array<UploadState & { localId: string }>, Function]} */
  const [uploads, setUploads] = useState(/** @type {any[]} */ ([]));
  /** @type {import('react').RefObject<Map<string, { file: any, uploadId: string | null }>>} */
  const jobs = useRef(new Map());

  const run = useCallback(
    /** @param {string} localId */
    async (localId) => {
      const job = jobs.current.get(localId);
      if (!job || !photoIo) return;
      const { uploadId } = await uploadPhoto({
        client,
        io: photoIo,
        file: job.file,
        resume: job.uploadId ? { uploadId: job.uploadId } : null,
        onState: (state) =>
          setUploads((/** @type {any[]} */ list) =>
            list.map((u) => (u.localId === localId ? { ...u, ...state } : u)),
          ),
        onProfile: (profile) => queryClient.setQueryData(keys.me(), profile),
      });
      job.uploadId = uploadId;
      await queryClient.invalidateQueries({ queryKey: keys.me() });
    },
    [client, photoIo, queryClient],
  );

  const add = useCallback(
    /** @param {readonly any[]} files */
    (files) => {
      for (const file of files) {
        const localId = newId();
        jobs.current.set(localId, { file, uploadId: null });
        setUploads((/** @type {any[]} */ list) => [
          ...list,
          { localId, phase: 'preparing', progress: 0, photoId: null, error: null },
        ]);
        void run(localId);
      }
    },
    [newId, run],
  );

  const retry = useCallback(
    /** @param {string} localId */
    (localId) => void run(localId),
    [run],
  );

  const dismiss = useCallback(
    /** @param {string} localId */
    (localId) => {
      jobs.current.delete(localId);
      setUploads((/** @type {any[]} */ list) => list.filter((u) => u.localId !== localId));
    },
    [],
  );

  return { uploads, add, retry, dismiss, available: Boolean(photoIo) };
}

/**
 * @template T
 * @param {T[]} list @param {number} from @param {number} to
 * @returns {T[]}
 */
export function moveItem(list, from, to) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/** Deletes a photo: removed from the cache at once, restored if the server refuses. */
export function useDeletePhoto() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {string} id */
    mutationFn: (id) => deleteMyPhoto(client, { params: { id } }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.me() });
      const previous = queryClient.getQueryData(keys.me());
      queryClient.setQueryData(keys.me(), (/** @type {any} */ profile) =>
        profile
          ? { ...profile, photos: profile.photos.filter((/** @type {any} */ p) => p.id !== id) }
          : profile,
      );
      return { previous };
    },
    onError: (_error, _id, context) => queryClient.setQueryData(keys.me(), context?.previous),
    onSuccess: (profile) => queryClient.setQueryData(keys.me(), profile),
  });
}

/** Reorders photos (the first is the main photo); optimistic, rolled back on error. */
export function useReorderPhotos() {
  const { client } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    /** @param {string[]} photoIds */
    mutationFn: (photoIds) => reorderMyPhotos(client, { body: { photoIds } }),
    onMutate: async (photoIds) => {
      await queryClient.cancelQueries({ queryKey: keys.me() });
      const previous = queryClient.getQueryData(keys.me());
      queryClient.setQueryData(keys.me(), (/** @type {any} */ profile) => {
        if (!profile) return profile;
        const byId = new Map(profile.photos.map((/** @type {any} */ p) => [p.id, p]));
        return {
          ...profile,
          photos: photoIds.flatMap((id, position) => {
            const photo = byId.get(id);
            return photo ? [{ ...photo, position }] : [];
          }),
        };
      });
      return { previous };
    },
    onError: (_error, _ids, context) => queryClient.setQueryData(keys.me(), context?.previous),
    onSuccess: (profile) => queryClient.setQueryData(keys.me(), profile),
  });
}
