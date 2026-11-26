// @ts-check
import {
  useMyProfile,
  usePushRegistration,
  useRealtimeEvent,
  useServices,
} from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Avatar, Button, Heart, Icon, Sheet, Text, useTheme, X } from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
  const { colors, space, radius, font, shadow } = useTheme();
  const me = useMyProfile();
  const myPhoto = me.data?.photos.find((p) => p.urls)?.urls?.w400 ?? null;
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
      <Modal
        visible={match !== null}
        animationType="fade"
        onRequestClose={() => setMatch(null)}
        aria-label={t('match.title')}
      >
        {match ? (
          <SafeAreaView
            accessibilityViewIsModal
            style={{ flex: 1, backgroundColor: colors.celebrateFrom }}
          >
            <View style={{ alignItems: 'flex-end', padding: space[2] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('ui.modal.close')}
                onPress={() => setMatch(null)}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon icon={X} color={colors.onPrimary} />
              </Pressable>
            </View>
            <View
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: space[5],
                gap: space[4],
                backgroundColor: colors.celebrateTo,
                borderTopLeftRadius: radius.modal,
                borderTopRightRadius: radius.modal,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar uri={myPhoto} alt="" name={me.data?.name ?? ''} size={112} ring />
                <View
                  style={{
                    zIndex: 1,
                    width: 52,
                    height: 52,
                    marginHorizontal: -14,
                    borderRadius: 26,
                    backgroundColor: colors.onPrimary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...shadow.card,
                  }}
                >
                  <Heart size={28} color={colors.primary} fill={colors.primary} />
                </View>
                <Avatar
                  uri={match.user.photos.at(0)?.w400 ?? null}
                  alt=""
                  name={match.user.name}
                  size={112}
                  ring
                />
              </View>
              <Text
                variant="h1"
                color={colors.onPrimary}
                style={{ ...font('h1'), fontSize: 34, lineHeight: 42, textAlign: 'center' }}
              >
                {t('match.title')}
              </Text>
              <Text color={colors.onPrimary} style={{ textAlign: 'center' }}>
                {t('match.body', { name: match.user.name })}
              </Text>
              <View style={{ alignSelf: 'stretch', gap: space[3], marginTop: space[3] }}>
                <Button
                  title={t('match.message')}
                  block
                  onPress={() => {
                    const target = match.conversationId ?? match.matchId;
                    setMatch(null);
                    void offerPush();
                    router.push(`/chat/${target}`);
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('match.later')}
                  onPress={() => {
                    setMatch(null);
                    void offerPush();
                  }}
                  style={({ pressed }) => ({
                    minHeight: 48,
                    borderRadius: radius.button,
                    borderWidth: 1.5,
                    borderColor: colors.onPrimary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text variant="label" color={colors.onPrimary}>
                    {t('match.later')}
                  </Text>
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        ) : null}
      </Modal>
      <Sheet open={askPush} onClose={() => setAskPush(false)} title={t('push.prompt.title')}>
        <Text style={{ marginBottom: space[3] }}>{t('push.prompt.body')}</Text>
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
