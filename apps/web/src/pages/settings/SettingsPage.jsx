// @ts-check
import { Slot } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Ban, Bell, Card, ChevronRight, Icon, Lock, ShieldCheck, UserRound } from '@vouch/ui-web';
import { Link } from 'react-router';
import { AccountActions } from '../../features/account/AccountActions.jsx';
import { BlockedUsers } from '../../features/blocked-users/BlockedUsers.jsx';
import { ReadReceiptsSetting } from '../../features/chat-privacy/ReadReceiptsSetting.jsx';
import { NotificationSettings } from '../../features/notification-settings/NotificationSettings.jsx';

/** Settings: notifications, blocked people, safety and privacy, account and data. */
export function SettingsPage() {
  return (
    <div className="w-page w-stack">
      <h1 className="w-title">{t('settings.title')}</h1>
      <Card as="section" aria-labelledby="s-notifications">
        <h2 id="s-notifications" className="w-subtitle w-subtitle--icon">
          <Icon icon={Bell} />
          {t('settings.notifications.title')}
        </h2>
        <NotificationSettings />
      </Card>
      <Card as="section" aria-labelledby="s-chat-privacy">
        <h2 id="s-chat-privacy" className="w-subtitle w-subtitle--icon">
          <Icon icon={Lock} />
          {t('settings.privacy.chat.title')}
        </h2>
        <ReadReceiptsSetting />
      </Card>
      <Card as="section" aria-labelledby="s-blocked">
        <h2 id="s-blocked" className="w-subtitle w-subtitle--icon">
          <Icon icon={Ban} />
          {t('settings.blocked.title')}
        </h2>
        <BlockedUsers />
      </Card>
      <Card as="section" aria-labelledby="s-help">
        <h2 id="s-help" className="w-subtitle w-subtitle--icon">
          <Icon icon={ShieldCheck} />
          {t('settings.safety.title')}
        </h2>
        <ul className="w-links">
          <li>
            <Link to="/settings/safety">
              {t('settings.safety.title')}
              <Icon icon={ChevronRight} size={20} />
            </Link>
          </li>
          <li>
            <Link to="/settings/privacy">
              {t('settings.privacy.title')}
              <Icon icon={ChevronRight} size={20} />
            </Link>
          </li>
        </ul>
      </Card>
      <Slot name="settings.rows" render={(item) => <item.component />} />
      <Card as="section" aria-labelledby="s-account">
        <h2 id="s-account" className="w-subtitle w-subtitle--icon">
          <Icon icon={UserRound} />
          {t('settings.account.title')}
        </h2>
        <AccountActions />
      </Card>
    </div>
  );
}
