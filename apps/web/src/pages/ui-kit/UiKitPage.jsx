// @ts-check
import { t } from '@vouch/i18n';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Heart,
  IconButton,
  Input,
  ListItem,
  OtpInput,
  Skeleton,
  StatusBadge,
  Toast,
  Wordmark,
  X,
} from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Every UI-kit component on one page (`/ui-kit`), used by the Playwright axe scan in light and
 * dark themes and for screenshots. It holds no data and needs no sign-in.
 */
export default function UiKitPage() {
  const [code, setCode] = useState('1234');
  return (
    <main className="w-page">
      <h1 className="w-title">UI kit</h1>
      <Wordmark height={48} />
      <Card as="section" aria-label="Buttons">
        <div className="w-row">
          <Button>{t('common.continue')}</Button>
          <Button variant="secondary">{t('common.back')}</Button>
          <Button variant="danger">{t('common.signOut')}</Button>
          <Button variant="ghost">{t('common.retry')}</Button>
          <Button loading>{t('common.loading')}</Button>
          <Button disabled>{t('common.continue')}</Button>
          <IconButton icon={X} label={t('deck.pass')} variant="secondary" size="lg" />
          <IconButton icon={Heart} label={t('deck.like')} variant="primary" size="lg" />
        </div>
      </Card>
      <Card as="section" aria-label="Fields">
        <Input
          label={t('auth.email.label')}
          hint={t('auth.signup.birthDate.hint')}
          placeholder={t('auth.email.placeholder')}
        />
        <Input label={t('auth.email.label')} error={t('auth.email.invalid')} defaultValue="nope" />
        <OtpInput label={t('auth.code.label')} value={code} onChange={setCode} />
      </Card>
      <Card as="section" aria-label="Content">
        <ListItem
          title="Asha"
          subtitle="Hi there"
          leading={<Avatar alt="Asha" name="Asha Rao" />}
          trailing={
            <Badge tone="accent" label="2 unread">
              2
            </Badge>
          }
          onClick={() => {}}
        />
        <ListItem
          title="Kabir"
          subtitle="See you Friday"
          leading={<Avatar alt="Kabir" name="Kabir" />}
          trailing={<Badge>new</Badge>}
        />
        <div className="w-row">
          <StatusBadge status="verified">{t('ui.kit.verified')}</StatusBadge>
          <StatusBadge status="pending">{t('photos.status.pending')}</StatusBadge>
          <StatusBadge status="rejected">{t('photos.status.rejected')}</StatusBadge>
          <Chip>Northfield</Chip>
        </div>
        <Skeleton height={20} />
        <Toast message={t('profile.saved')} tone="success" />
        <Toast message={t('common.offline')} />
        <Toast message={t('common.error')} tone="error" onDismiss={() => {}} />
        <EmptyState title={t('home.empty.title')} body={t('home.empty.body')} />
      </Card>
    </main>
  );
}
