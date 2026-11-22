// @ts-check
import { t } from '@vouch/i18n';
import { DeckWidget } from '../../widgets/deck/DeckWidget.jsx';

export function DiscoverPage() {
  return (
    <div className="w-page">
      <h1 className="v-visually-hidden">{t('deck.title')}</h1>
      <DeckWidget />
    </div>
  );
}
