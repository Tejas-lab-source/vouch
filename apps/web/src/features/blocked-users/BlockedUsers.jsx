// @ts-check
import { useBlockedUsers, useUnblock } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, Skeleton } from '@vouch/ui-web';

/** The people I blocked, with Unblock. */
export function BlockedUsers() {
  const blocked = useBlockedUsers();
  const unblock = useUnblock();
  if (blocked.isLoading) return <Skeleton height={48} />;
  const items = blocked.data ?? [];
  return (
    <div>
      <p className="v-field__hint">{t('settings.blocked.hint')}</p>
      {items.length === 0 ? <p>{t('settings.blocked.empty')}</p> : null}
      <ul className="w-list">
        {items.map((b) => {
          const name = b.name ?? t('settings.blocked.unknown');
          return (
            <li key={b.userId} className="w-list__row">
              <span>{name}</span>
              <Button
                variant="secondary"
                aria-label={t('settings.blocked.unblockNamed', { name })}
                loading={unblock.isPending && unblock.variables === b.userId}
                onClick={() => unblock.mutate(b.userId)}
              >
                {t('settings.blocked.unblock')}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
