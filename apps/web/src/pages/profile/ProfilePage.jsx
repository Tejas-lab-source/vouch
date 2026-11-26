// @ts-check
import { Slot, useMyProfile } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, Card, Chip, EmptyState, Skeleton } from '@vouch/ui-web';
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

/** Your profile: status, fields, photos, and the `profile.sections` / `profile.editor` slots. */
export function ProfilePage() {
  const profile = useMyProfile();
  if (profile.isLoading) {
    return (
      <div className="w-page" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton height={200} />
      </div>
    );
  }
  if (!profile.data) {
    return (
      <EmptyState
        title={t('common.error')}
        action={<Button onClick={() => void profile.refetch()}>{t('common.retry')}</Button>}
      />
    );
  }
  const me = profile.data;
  return (
    <div className="w-page">
      <h1 className="w-title">{t('profile.title')}</h1>
      <Card as="section" className="w-me" aria-label={me.name ?? t('profile.title')}>
        <Avatar
          src={me.photos.find((p) => p.urls)?.urls?.w400 ?? null}
          alt=""
          name={me.name ?? ''}
          size={96}
        />
        <div className="w-me__text">
          <p className="w-me__name">
            {me.name ? t('deck.card.label', { name: me.name, age: me.age }) : null}
          </p>
          <p role="status">
            <Chip>
              {t(/** @type {import('@vouch/i18n').MessageKey} */ (STATUS.get(me.status)))}
            </Chip>
          </p>
        </div>
      </Card>
      <Slot name="profile.sections" render={(item) => <item.component profile={me} />} />
      <PhotoManager profile={me} />
      <Card as="section" aria-label={t('onboarding.basics.title')}>
        <BasicsForm profile={me} submitLabel={t('profile.save')} />
      </Card>
      <Card as="section" aria-label={t('profile.bio.label')}>
        <BioForm profile={me} />
      </Card>
      <Card as="section" aria-label={t('profile.interestedIn.label')}>
        <InterestedInForm profile={me} submitLabel={t('profile.save')} />
      </Card>
      <Card as="section" aria-label={t('profile.ageRange.label')}>
        <AgeRangeForm profile={me} submitLabel={t('profile.save')} />
      </Card>
      <Slot name="profile.editor" render={(item) => <item.component profile={me} />} />
    </div>
  );
}
