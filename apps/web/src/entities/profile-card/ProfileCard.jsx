// @ts-check
import { t } from '@vouch/i18n';
import { Button } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Someone's profile card. The deck shows the 400 px photo; "View profile" opens the details
 * with every photo at 1080 px. Images load lazily and are cached by the browser.
 * @param {{ card: import('@vouch/features-core').ProfileCard, badges?: import('react').ReactNode, actions?: import('react').ReactNode, headingLevel?: 2 | 3 }} props
 */
export function ProfileCard({ card, badges = null, actions = null, headingLevel = 2 }) {
  const [open, setOpen] = useState(false);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const label = t('deck.card.label', { name: card.name, age: card.age });
  const main = card.photos.at(0);
  return (
    <article className="w-card" aria-label={label}>
      {main ? (
        <img
          className="w-card__photo"
          src={main.w400}
          alt={t('deck.card.photo', { n: 1, name: card.name })}
          width={400}
          height={500}
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <div className="w-card__body">
        <Heading className="w-card__title">{label}</Heading>
        <p className="w-card__meta">{card.collegeName}</p>
        {badges ? <div className="w-row">{badges}</div> : null}
        <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('deck.card.less') : t('deck.card.more')}
        </Button>
        {open ? (
          <div className="w-card__details">
            {card.bio ? <p>{card.bio}</p> : null}
            {card.photos.map((photo, i) => (
              <img
                key={photo.w1080}
                className="w-card__detail-photo"
                src={photo.w1080}
                alt={t('deck.card.photo', { n: i + 1, name: card.name })}
                width={1080}
                height={1350}
                loading="lazy"
                decoding="async"
              />
            ))}
          </div>
        ) : null}
        {actions}
      </div>
    </article>
  );
}
