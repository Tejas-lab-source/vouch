// @ts-check
import { moveItem, useDeletePhoto, usePhotoUploads, useReorderPhotos } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Badge, Button } from '@vouch/ui-web';
import { useRef } from 'react';
import { ACCEPT_ATTRIBUTE } from '../../shared/lib/photo-io.js';

const MAX_PHOTOS = 6;

/** @type {Map<string, 'neutral' | 'accent' | 'danger'>} */
const TONE = new Map([
  ['approved', 'accent'],
  ['pending', 'neutral'],
  ['rejected', 'danger'],
]);

/** @param {import('@vouch/features-core').UploadState} upload */
function uploadLabel(upload) {
  switch (upload.phase) {
    case 'preparing':
      return t('photos.upload.preparing');
    case 'uploading':
      return t('photos.upload.uploading', { percent: Math.round(upload.progress * 100) });
    case 'confirming':
    case 'processing':
      return t('photos.upload.processing');
    case 'failed':
      return t('photos.upload.failed');
    case 'approved':
      return t('photos.status.approved');
    case 'rejected':
      return t('photos.status.rejected');
    default:
      return t('photos.status.pending');
  }
}

/**
 * The user's photos: add (resized to 2048 px before upload), per-photo status, delete, and
 * reorder with "earlier"/"later" buttons (keyboard and screen-reader friendly). The first
 * photo is the main one.
 * @param {{ profile: import('@vouch/features-core').OwnProfile }} props
 */
export function PhotoManager({ profile }) {
  const { uploads, add, retry, dismiss } = usePhotoUploads();
  const remove = useDeletePhoto();
  const reorder = useReorderPhotos();
  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  const photos = profile.photos;
  const inFlight = uploads.filter((u) => !u.photoId || !photos.some((p) => p.id === u.photoId));
  const room = MAX_PHOTOS - photos.length - inFlight.filter((u) => u.phase !== 'failed').length;
  const ids = photos.map((p) => p.id);

  return (
    <section className="w-photos" aria-labelledby="photos-title">
      <h2 id="photos-title" className="w-title">
        {t('photos.title')}
      </h2>
      <p className="v-field__hint">{t('photos.hint')}</p>
      <ol className="w-photo-grid">
        {photos.map((photo, i) => (
          <li key={photo.id} className="w-photo">
            {photo.urls ? (
              <img
                src={photo.urls.w400}
                alt={t('photos.alt', { n: i + 1 })}
                width={160}
                height={200}
                loading="lazy"
              />
            ) : (
              <div
                className="w-photo__placeholder"
                role="img"
                aria-label={t('photos.alt', { n: i + 1 })}
              />
            )}
            <Badge tone={TONE.get(photo.status) ?? 'neutral'}>
              {t(/** @type {any} */ (`photos.status.${photo.status}`))}
            </Badge>
            <div className="w-photo__actions">
              <Button
                variant="ghost"
                aria-label={t('photos.moveEarlier', { n: i + 1 })}
                disabled={i === 0 || reorder.isPending}
                onClick={() => reorder.mutate(moveItem(ids, i, i - 1))}
              >
                ←
              </Button>
              <Button
                variant="ghost"
                aria-label={t('photos.moveLater', { n: i + 1 })}
                disabled={i === photos.length - 1 || reorder.isPending}
                onClick={() => reorder.mutate(moveItem(ids, i, i + 1))}
              >
                →
              </Button>
              <Button
                variant="ghost"
                aria-label={t('photos.delete', { n: i + 1 })}
                onClick={() => remove.mutate(photo.id)}
              >
                ×
              </Button>
            </div>
          </li>
        ))}
        {inFlight.map((upload) => (
          <li key={upload.localId} className="w-photo w-photo--uploading" aria-live="polite">
            <div className="w-photo__placeholder" aria-hidden="true" />
            <span>{uploadLabel(upload)}</span>
            {upload.phase === 'uploading' ? (
              <progress max={1} value={upload.progress} aria-label={uploadLabel(upload)} />
            ) : null}
            {upload.phase === 'failed' ? (
              <div className="w-row">
                <Button variant="secondary" onClick={() => retry(upload.localId)}>
                  {t('common.retry')}
                </Button>
                <Button variant="ghost" onClick={() => dismiss(upload.localId)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <input
        ref={input}
        className="v-visually-hidden"
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])].slice(0, Math.max(0, room));
          if (files.length > 0) add(files);
          event.target.value = '';
        }}
      />
      {room > 0 ? (
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {t('photos.add')}
        </Button>
      ) : (
        <p className="v-field__hint">{t('photos.limit')}</p>
      )}
    </section>
  );
}
