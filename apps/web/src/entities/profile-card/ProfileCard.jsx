// @ts-check
import { t } from '@vouch/i18n';
import { Button, Chip, GraduationCap, Icon } from '@vouch/ui-web';
import { useState } from 'react';

/**
 * Someone's profile card: the 400 px photo with the name over a soft gradient, the college as a
 * chip, then "View profile" for the bio and every photo at 1080 px. Images load lazily and are
 * cached by the browser. Only fields we have are shown (name, age, college, bio, photos).
 * @param {{ card: import('@vouch/features-core').ProfileCard, badges?: import('react').ReactNode, actions?: import('react').ReactNode, headingLevel?: 2 | 3 }} props
 */
export function ProfileCard({ card, badges = null, actions = null, headingLevel = 2 }) {
  const [open, setOpen] = useState(false);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const label = t('deck.card.label', { name: card.name, age: card.age });
  const main = card.photos.at(0);
  return (
    <article className="w-card" aria-label={label}>
      <div className="w-card__media">
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
        ) : (
          <div className="w-card__photo" />
        )}
        {card.photos.length > 1 ? (
          <span className="w-card__count" aria-hidden="true">
            1 / {card.photos.length}
          </span>
        ) : null}
      </div>
      <div className="w-card__body">
        <Heading className="w-card__title">{label}</Heading>
        <div className="w-row">
          <Chip>
            <Icon icon={GraduationCap} size={14} />
            {card.collegeName}
          </Chip>
          {badges}
        </div>
        {card.bio && !open ? <p className="w-card__bio">{card.bio}</p> : null}
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
