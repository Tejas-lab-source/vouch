// @ts-check
import { usePushRegistration, useRealtimeEvent, useServices } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, Sheet, useTheme } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Text, View } from 'react-native';

/** @typedef {{ matchId: string, conversationId: string | null, user: { userId: string, name: string, photos: { w400: string }[] } }} MatchMomentData */

const MatchContext = createContext(
  /** @type {(match: MatchMomentData) => boolean} */ (() => false),
);

/** Shows a match (from a swipe); false if it was already shown. */
export const useShowMatch = () => useContext(MatchContext);

/**
 * The match moment: on a like that matched, or a `match.new` socket event. Each match is shown
 * (and counted) once, although the swiper receives both.
 * @param {{ children: import('react').ReactNode }} props
 */
export function MatchMomentProvider({ children }) {
  const services = useServices();
  const { analytics } = services;
  const { colors, space } = useTheme();
  const router = useRouter();
  const [match, setMatch] = useState(/** @type {MatchMomentData | null} */ (null));
  // After the first match (never at install) the app offers push notifications once.
  const push = usePushRegistration();
  const [askPush, setAskPush] = useState(false);
  const asked = useRef(false);
  const offerPush = async () => {
    const { push: port } = /** @type {any} */ (services);
    if (asked.current || !port) return;
    asked.current = true;
    if ((await port.status()) === 'undetermined') setAskPush(true);
  };
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
  return (
    <MatchContext.Provider value={show}>
      {children}
      <Sheet open={match !== null} onClose={() => setMatch(null)} title={t('match.title')}>
        {match ? (
          <View style={{ alignItems: 'center', gap: space[3] }}>
            <Avatar
              uri={match.user.photos.at(0)?.w400 ?? null}
              alt=""
              name={match.user.name}
              size={96}
            />
            <Text style={{ color: colors.text }}>{t('match.body', { name: match.user.name })}</Text>
            <Button
              title={t('match.message')}
              onPress={() => {
                const target = match.conversationId ?? match.matchId;
                setMatch(null);
                void offerPush();
                router.push(`/chat/${target}`);
              }}
            />
            <Button
              variant="secondary"
              title={t('match.later')}
              onPress={() => {
                setMatch(null);
                void offerPush();
              }}
            />
          </View>
        ) : null}
      </Sheet>
      <Sheet open={askPush} onClose={() => setAskPush(false)} title={t('push.prompt.title')}>
        <Text style={{ color: colors.text, marginBottom: space[3] }}>{t('push.prompt.body')}</Text>
        <Button
          title={t('push.prompt.allow')}
          onPress={() => {
            setAskPush(false);
            void push.askNow();
          }}
        />
        <Button variant="ghost" title={t('push.prompt.later')} onPress={() => setAskPush(false)} />
      </Sheet>
    </MatchContext.Provider>
  );
}
