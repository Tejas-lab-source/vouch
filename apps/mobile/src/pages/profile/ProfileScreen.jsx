// @ts-check
import { Slot, useMyProfile } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  IconButton,
  Settings,
  Skeleton,
  Text,
  useTheme,
} from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { PhotoManager } from '../../features/photo-manager/PhotoManager.jsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.jsx';
import {
  AgeRangeForm,
  BasicsForm,
  BioForm,
  InterestedInForm,
} from '../../features/profile-fields/forms.jsx';

/** @type {Map<string, import('@vouch/i18n').MessageKey>} */
const STATUS = new Map([
  ['pending', 'profile.status.pending'],
  ['active', 'profile.status.active'],
  ['hidden', 'profile.status.hidden'],
]);

/** Your profile: status, photos, fields, and the `profile.sections` / `profile.editor` slots. */
export function ProfileScreen() {
  const { colors, space } = useTheme();
  const router = useRouter();
  const profile = useMyProfile();
  if (profile.isLoading) return <Skeleton height={200} />;
  if (!profile.data) {
    return (
      <EmptyState
        title={t('common.error')}
        action={<Button title={t('common.retry')} onPress={() => void profile.refetch()} />}
      />
    );
  }
  const me = profile.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title={t('profile.title')}
        right={
          <IconButton
            icon={Settings}
            label={t('settings.open')}
            onPress={() => router.push('/settings')}
          />
        }
      />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ padding: space[4], paddingTop: space[2], gap: space[4] }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', gap: space[2] }}>
          <Avatar
            uri={me.photos.find((p) => p.urls)?.urls?.w400 ?? null}
            alt=""
            name={me.name ?? ''}
            size={104}
          />
          {me.name ? (
            <Text variant="h2">{t('deck.card.label', { name: me.name, age: me.age })}</Text>
          ) : null}
          <Chip>{t(/** @type {import('@vouch/i18n').MessageKey} */ (STATUS.get(me.status)))}</Chip>
        </View>
        <Button
          variant="secondary"
          icon={Settings}
          title={t('settings.open')}
          onPress={() => router.push('/settings')}
        />
        <Slot name="profile.sections" render={(item) => <item.component profile={me} />} />
        <PhotoManager profile={me} />
        {[BasicsForm, BioForm, InterestedInForm, AgeRangeForm].map((Form, i) => (
          <Card key={i}>
            <View>
              <Form profile={me} submitLabel={t('profile.save')} />
            </View>
          </Card>
        ))}
        <Slot name="profile.editor" render={(item) => <item.component profile={me} />} />
      </ScrollView>
    </View>
  );
}
