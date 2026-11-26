// @ts-check
import { moveItem, useDeletePhoto, usePhotoUploads, useReorderPhotos } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Button,
  ChevronLeft,
  ChevronRight,
  IconButton,
  ImagePlus,
  StatusBadge,
  Text,
  Trash2,
  useTheme,
} from '@vouch/ui-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useWindowDimensions, View } from 'react-native';

const MAX_PHOTOS = 6;

/** @param {import('@vouch/features-core').UploadState} upload */
function uploadLabel(upload) {
  if (upload.phase === 'uploading') {
    return t('photos.upload.uploading', { percent: Math.round(upload.progress * 100) });
  }
  if (upload.phase === 'preparing') return t('photos.upload.preparing');
  if (upload.phase === 'failed') return t('photos.upload.failed');
  if (upload.phase === 'approved') return t('photos.status.approved');
  if (upload.phase === 'rejected') return t('photos.status.rejected');
  return t('photos.upload.processing');
}

/**
 * The user's photos: pick from the library (resized to 2048 px before upload), per-photo status,
 * delete, and reorder with "earlier"/"later" buttons. The first photo is the main one.
 * @param {{ profile: import('@vouch/features-core').OwnProfile }} props
 */
export function PhotoManager({ profile }) {
  const { colors, space, radius } = useTheme();
  // Two tiles per row on a phone (each wide enough for its three controls).
  const { width: screen } = useWindowDimensions();
  const tile = Math.max(140, Math.floor((Math.min(screen, 520) - space[5] * 2 - space[3]) / 2));
  const tileHeight = Math.round((tile * 5) / 4);
  const { uploads, add, retry, dismiss } = usePhotoUploads();
  const remove = useDeletePhoto();
  const reorder = useReorderPhotos();
  const photos = profile.photos;
  const ids = photos.map((p) => p.id);
  const inFlight = uploads.filter((u) => !u.photoId || !ids.includes(u.photoId));
  const room = MAX_PHOTOS - photos.length - inFlight.filter((u) => u.phase !== 'failed').length;

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, room),
      exif: false,
      quality: 1,
    });
    if (!result.canceled) add(result.assets.slice(0, room));
  }

  return (
    <View style={{ marginBottom: space[5] }}>
      <Text variant="h2">{t('photos.title')}</Text>
      <Text muted style={{ marginTop: space[1] }}>
        {t('photos.hint')}
      </Text>
      <Text variant="caption" muted style={{ marginBottom: space[3], marginTop: space[1] }}>
        {t('photos.reviewNote')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {photos.map((photo, i) => (
          <View key={photo.id} style={{ width: tile, gap: space[1] }}>
            {photo.urls ? (
              <Image
                source={{ uri: photo.urls.w400 }}
                accessibilityLabel={t('photos.alt', { n: i + 1 })}
                cachePolicy="memory-disk"
                style={{ width: tile, height: tileHeight, borderRadius: radius.card }}
              />
            ) : (
              <View
                accessibilityRole="image"
                accessibilityLabel={t('photos.alt', { n: i + 1 })}
                style={{
                  width: tile,
                  height: tileHeight,
                  borderRadius: radius.card,
                  backgroundColor: colors.surfaceMuted,
                }}
              />
            )}
            <StatusBadge status={photo.status}>
              {t(/** @type {any} */ (`photos.status.${photo.status}`))}
            </StatusBadge>
            <View style={{ flexDirection: 'row' }}>
              <IconButton
                icon={ChevronLeft}
                label={t('photos.moveEarlier', { n: i + 1 })}
                disabled={i === 0 || reorder.isPending}
                onPress={() => reorder.mutate(moveItem(ids, i, i - 1))}
              />
              <IconButton
                icon={ChevronRight}
                label={t('photos.moveLater', { n: i + 1 })}
                disabled={i === photos.length - 1 || reorder.isPending}
                onPress={() => reorder.mutate(moveItem(ids, i, i + 1))}
              />
              <IconButton
                icon={Trash2}
                label={t('photos.delete', { n: i + 1 })}
                onPress={() => remove.mutate(photo.id)}
              />
            </View>
          </View>
        ))}
        {inFlight.map((upload) => (
          <View
            key={upload.localId}
            style={{ width: tile, gap: space[1] }}
            accessibilityLiveRegion="polite"
          >
            <View
              style={{
                width: tile,
                height: tileHeight,
                borderRadius: radius.card,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: colors.border,
                backgroundColor: colors.surfaceMuted,
              }}
            />
            <Text variant="caption">{uploadLabel(upload)}</Text>
            {upload.phase === 'failed' ? (
              <View style={{ flexDirection: 'row' }}>
                <Button
                  variant="secondary"
                  title={t('common.retry')}
                  onPress={() => retry(upload.localId)}
                />
                <Button
                  variant="ghost"
                  title={t('common.cancel')}
                  onPress={() => dismiss(upload.localId)}
                />
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {room > 0 ? (
        <View style={{ marginTop: space[3] }}>
          <Button
            variant="secondary"
            icon={ImagePlus}
            title={t('photos.add')}
            onPress={() => void pick()}
          />
        </View>
      ) : (
        <Text muted style={{ marginTop: space[3] }}>
          {t('photos.limit')}
        </Text>
      )}
    </View>
  );
}
