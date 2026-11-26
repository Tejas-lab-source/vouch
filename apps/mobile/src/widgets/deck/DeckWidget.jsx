// @ts-check
import { Slot, useDeck, useSwipe } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import {
  Button,
  EmptyState,
  Heart,
  IconButton,
  Settings,
  Skeleton,
  useTheme,
  X,
} from '@vouch/ui-native';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ProfileCard } from '../../entities/profile-card/ProfileCard.jsx';
import { CardSafetyActions } from '../../features/card-safety/CardSafetyActions.jsx';
import { useShowMatch } from '../../features/match-moment/MatchMoment.jsx';
import { CampusIllustration } from '../../shared/ui/Illustration.jsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.jsx';

/** A swipe counts past this share of the screen width. */
const THRESHOLD = 0.3;

/**
 * The deck. Drag the top card right to like or left to pass. The drag, the fling and the
 * spring back run as worklets on the UI thread (Gesture Handler + Reanimated, ADR 0027), so a
 * busy JS thread cannot drop frames; JS runs only once, when a swipe is decided. The Like and
 * Pass buttons and the card's accessibility actions do the same for keyboard and screen-reader
 * users. Cards leave at once; a failed swipe brings the card back.
 */
export function DeckWidget() {
  const { space, colors } = useTheme();
  const router = useRouter();
  const header = (
    <ScreenHeader
      brand
      right={
        <IconButton
          icon={Settings}
          label={t('settings.open')}
          onPress={() => router.push('/settings')}
        />
      }
    />
  );
  const { width } = useWindowDimensions();
  const deck = useDeck();
  const showMatch = useShowMatch();
  const swipe = useSwipe({
    onMatch: ({ matchId, card }) => showMatch({ matchId, conversationId: matchId, user: card }),
  });
  const current = deck.current;
  const x = useSharedValue(0);
  const latest = useRef({ current, swipe });
  latest.current = { current, swipe };

  /** Runs on the JS thread once the card has left: records the swipe. @param {'like' | 'pass'} direction */
  const decide = (direction) => {
    const card = latest.current.current;
    x.value = 0;
    if (!card) return;
    void (direction === 'like' ? latest.current.swipe.like(card) : latest.current.swipe.pass(card));
  };

  /**
   * Animates the card out, then records the swipe. A worklet: called from the gesture on the
   * UI thread, or from the buttons on the JS thread (the animation itself always runs on UI).
   * @param {'like' | 'pass'} direction
   */
  const flyOut = (direction) => {
    'worklet';
    x.value = withTiming(
      direction === 'like' ? width * 1.5 : -width * 1.5,
      { duration: 180 },
      (/** @type {boolean | undefined} */ done) => {
        if (done) scheduleOnRN(decide, direction);
      },
    );
  };
  /** @param {'like' | 'pass'} direction */
  const fling = (direction) => {
    if (latest.current.current) flyOut(direction);
  };

  // Horizontal drags only: a vertical move first leaves the gesture to the scroll view.
  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      'worklet';
      x.value = event.translationX;
    },
    onDeactivate: (event) => {
      'worklet';
      const direction =
        event.translationX > width * THRESHOLD
          ? 'like'
          : event.translationX < -width * THRESHOLD
            ? 'pass'
            : null;
      if (direction) flyOut(direction);
      else x.value = withSpring(0);
    },
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { rotate: `${interpolate(x.value, [-width, 0, width], [-12, 0, 12])}deg` },
    ],
  }));

  if (deck.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <View style={{ padding: space[4] }}>
          <Skeleton height={420} />
        </View>
      </View>
    );
  }
  if (deck.isError || !current) {
    const incomplete = /** @type {any} */ (deck.error)?.code === 'PROFILE_INCOMPLETE';
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {header}
        <EmptyState
          art={<CampusIllustration width={280} />}
          title={
            deck.isError
              ? incomplete
                ? t('deck.incomplete')
                : t('common.error')
              : t('deck.empty.title')
          }
          body={deck.isError ? undefined : t('deck.empty.body')}
          action={
            <Button
              variant="secondary"
              title={t('deck.empty.refresh')}
              onPress={() => void deck.refetch()}
            />
          }
        />
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {header}
      <ScrollView
        contentContainerStyle={{ padding: space[4], paddingTop: space[1], gap: space[4] }}
      >
        <GestureDetector gesture={pan}>
          <Animated.View
            key={current.userId}
            accessibilityActions={[
              { name: 'like', label: t('deck.like') },
              { name: 'pass', label: t('deck.pass') },
            ]}
            onAccessibilityAction={(/** @type {any} */ event) =>
              fling(event.nativeEvent.actionName === 'like' ? 'like' : 'pass')
            }
            style={cardStyle}
          >
            <ProfileCard
              card={current}
              badges={
                <Slot name="deck.cardBadges" render={(item) => <item.component card={current} />} />
              }
              actions={<CardSafetyActions user={current} />}
            />
          </Animated.View>
        </GestureDetector>
        <View style={{ flexDirection: 'row', gap: space[8], justifyContent: 'center' }}>
          <IconButton
            icon={X}
            label={t('deck.pass')}
            variant="secondary"
            size="lg"
            onPress={() => fling('pass')}
          />
          <IconButton
            icon={Heart}
            label={t('deck.like')}
            variant="primary"
            size="lg"
            onPress={() => fling('like')}
          />
        </View>
      </ScrollView>
    </View>
  );
}
