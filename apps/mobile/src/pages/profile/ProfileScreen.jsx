// @ts-check
import { Slot, useMyProfile } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Card, EmptyState, Skeleton, useTheme } from '@vouch/ui-native';
import { ScrollView, Text, View } from 'react-native';
import { PhotoManager } from '../../features/photo-manager/PhotoManager.jsx';
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
  const { colors, space, type } = useTheme();
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
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space[4], gap: space[4] }}
      keyboardShouldPersistTaps="handled"
    >
      <Text
        accessibilityRole="header"
        style={{ color: colors.text, fontSize: type.title.size, fontWeight: '700' }}
      >
        {t('profile.title')}
      </Text>
      <Text style={{ color: colors.textMuted }}>
        {t(/** @type {import('@vouch/i18n').MessageKey} */ (STATUS.get(me.status)))}
      </Text>
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
  );
}
