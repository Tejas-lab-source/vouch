// @ts-check
import { Slot, useDeck, useSwipe } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Heart, IconButton, Illustration, Skeleton, X } from '@vouch/ui-web';
import { useEffect } from 'react';
import { ProfileCard } from '../../entities/profile-card/ProfileCard.jsx';
import { CardSafetyActions } from '../../features/card-safety/CardSafetyActions.jsx';
import { useShowMatch } from '../../features/match-moment/MatchMoment.jsx';

/**
 * The deck: the top card with Like and Pass buttons, and the keyboard (← pass, → like). Cards
 * leave at once; a failed swipe puts the card back. `deck.cardBadges` items render on the card.
 */
export function DeckWidget() {
  const deck = useDeck();
  const showMatch = useShowMatch();
  const swipe = useSwipe({
    onMatch: ({ matchId, card }) => showMatch({ matchId, conversationId: matchId, user: card }),
  });
  const current = deck.current;

  useEffect(() => {
    if (!current) return undefined;
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      const target = /** @type {HTMLElement | null} */ (event.target);
      if (target?.closest('input, textarea, select, dialog[open]')) return;
      if (event.key === 'ArrowRight') void swipe.like(current);
      if (event.key === 'ArrowLeft') void swipe.pass(current);
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [current, swipe]);

  if (deck.isLoading) {
    return (
      <div aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton height={420} />
      </div>
    );
  }
  if (deck.isError) {
    const incomplete = /** @type {any} */ (deck.error)?.code === 'PROFILE_INCOMPLETE';
    return (
      <EmptyState
        title={incomplete ? t('deck.incomplete') : t('common.error')}
        action={<Button onClick={() => void deck.refetch()}>{t('common.retry')}</Button>}
      />
    );
  }
  if (!current) {
    return (
      <EmptyState
        art={<Illustration name="campus" className="w-empty-art" />}
        title={t('deck.empty.title')}
        body={t('deck.empty.body')}
        action={
          <Button variant="secondary" onClick={() => void deck.refetch()}>
            {t('deck.empty.refresh')}
          </Button>
        }
      />
    );
  }
  return (
    <section className="w-deck" aria-label={t('deck.title')}>
      <ProfileCard
        key={current.userId}
        card={current}
        badges={
          <Slot name="deck.cardBadges" render={(item) => <item.component card={current} />} />
        }
        actions={<CardSafetyActions user={current} />}
      />
      <div className="w-deck__buttons">
        <IconButton
          icon={X}
          label={t('deck.pass')}
          variant="secondary"
          size="lg"
          onClick={() => void swipe.pass(current)}
        />
        <IconButton
          icon={Heart}
          label={t('deck.like')}
          variant="primary"
          size="lg"
          onClick={() => void swipe.like(current)}
        />
      </div>
      <p className="v-field__hint">{t('deck.keyboardHint')}</p>
      {swipe.error ? (
        <p className="v-field__error" role="alert">
          {t('common.error')}
        </p>
      ) : null}
    </section>
  );
}
