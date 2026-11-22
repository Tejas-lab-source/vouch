// @ts-check
import { moveItem, useDeletePhoto, usePhotoUploads, useReorderPhotos } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Badge, Button, useTheme } from '@vouch/ui-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Text, View } from 'react-native';

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
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontWeight: '700', fontSize: 20 }}
      >
        {t('photos.title')}
      </Text>
      <Text style={{ color: colors.textMuted, marginBottom: space[3] }}>{t('photos.hint')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {photos.map((photo, i) => (
          <View key={photo.id} style={{ width: 150, gap: space[1] }}>
            {photo.urls ? (
              <Image
                source={{ uri: photo.urls.w400 }}
                accessibilityLabel={t('photos.alt', { n: i + 1 })}
                cachePolicy="memory-disk"
                style={{ width: 150, height: 188, borderRadius: radius.md }}
              />
            ) : (
              <View
                accessibilityRole="image"
                accessibilityLabel={t('photos.alt', { n: i + 1 })}
                style={{
                  width: 150,
                  height: 188,
                  borderRadius: radius.md,
                  backgroundColor: colors.border,
                }}
              />
            )}
            <Badge
              tone={
                photo.status === 'approved'
                  ? 'accent'
                  : photo.status === 'rejected'
                    ? 'danger'
                    : 'neutral'
              }
            >
              {t(/** @type {any} */ (`photos.status.${photo.status}`))}
            </Badge>
            <View style={{ flexDirection: 'row' }}>
              <Button
                variant="ghost"
                title="←"
                accessibilityLabel={t('photos.moveEarlier', { n: i + 1 })}
                disabled={i === 0 || reorder.isPending}
                onPress={() => reorder.mutate(moveItem(ids, i, i - 1))}
              />
              <Button
                variant="ghost"
                title="→"
                accessibilityLabel={t('photos.moveLater', { n: i + 1 })}
                disabled={i === photos.length - 1 || reorder.isPending}
                onPress={() => reorder.mutate(moveItem(ids, i, i + 1))}
              />
              <Button
                variant="ghost"
                title="×"
                accessibilityLabel={t('photos.delete', { n: i + 1 })}
                onPress={() => remove.mutate(photo.id)}
              />
            </View>
          </View>
        ))}
        {inFlight.map((upload) => (
          <View
            key={upload.localId}
            style={{ width: 150, gap: space[1] }}
            accessibilityLiveRegion="polite"
          >
            <View
              style={{
                width: 150,
                height: 188,
                borderRadius: radius.md,
                backgroundColor: colors.border,
              }}
            />
            <Text style={{ color: colors.text }}>{uploadLabel(upload)}</Text>
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
        <Button variant="secondary" title={t('photos.add')} onPress={() => void pick()} />
      ) : (
        <Text style={{ color: colors.textMuted }}>{t('photos.limit')}</Text>
      )}
    </View>
  );
}
