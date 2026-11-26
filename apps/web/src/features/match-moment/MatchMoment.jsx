// @ts-check
import { useMyProfile, useRealtimeEvent, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, Heart, Icon, Modal } from '@vouch/ui-web';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * @typedef {{ matchId: string, conversationId: string | null, user: { userId: string, name: string, photos: { w400: string }[] } }} MatchMomentData
 */

const MatchContext = createContext(
  /** @type {(match: MatchMomentData) => boolean} */ (() => false),
);

/** Shows a match (from a swipe); false if it was already shown. @returns {(match: MatchMomentData) => boolean} */
export const useShowMatch = () => useContext(MatchContext);

/**
 * The match moment. Opens on a like that matched (`useShowMatch`) or on a `match.new` socket
 * event (the other person liked back while you were elsewhere). "Send a message" goes to the
 * chat route.
 * @param {{ children: import('react').ReactNode }} props
 */
export function MatchMomentProvider({ children }) {
  const { analytics } = useServices();
  const navigate = useNavigate();
  const [match, setMatch] = useState(/** @type {MatchMomentData | null} */ (null));
  const me = useMyProfile();
  const myPhoto = me.data?.photos.find((p) => p.urls)?.urls?.w400 ?? null;
  // The swiper gets both the swipe answer and `match.new`: show (and count) each match once.
  const shown = useRef(new Set());
  const show = useCallback((/** @type {MatchMomentData} */ next) => {
    if (shown.current.has(next.matchId)) return false;
    shown.current.add(next.matchId);
    setMatch(next);
    return true;
  }, []);
  useRealtimeEvent('match.new', (payload) => {
    if (show(payload)) analytics?.track('match', { source: 'socket' });
  });
  const value = useMemo(() => show, [show]);
  return (
    <MatchContext.Provider value={value}>
      {children}
      <Modal
        open={match !== null}
        onClose={() => setMatch(null)}
        title={t('match.title')}
        className="v-modal--celebrate"
      >
        {match ? (
          <div className="w-match">
            <div className="w-match__pair" aria-hidden="true">
              <Avatar src={myPhoto} alt="" name={me.data?.name ?? ''} size={104} />
              <span className="w-match__heart">
                <Icon icon={Heart} size={28} />
              </span>
              <Avatar
                src={match.user.photos.at(0)?.w400 ?? null}
                alt=""
                name={match.user.name}
                size={104}
              />
            </div>
            <p className="w-match__body">{t('match.body', { name: match.user.name })}</p>
            <Button
              block
              onClick={() => {
                const target = match.conversationId ?? match.matchId;
                setMatch(null);
                navigate(`/chats/${target}`);
              }}
            >
              {t('match.message')}
            </Button>
            <Button block variant="secondary" onClick={() => setMatch(null)}>
              {t('match.later')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </MatchContext.Provider>
  );
}
