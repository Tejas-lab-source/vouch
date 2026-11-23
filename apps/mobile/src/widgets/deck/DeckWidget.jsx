// @ts-check
import { Slot, useDeck, useSwipe } from '@vouch/features-core';
import { t } from '@vouch/i18n';
import { Button, EmptyState, Skeleton, useTheme } from '@vouch/ui-native';
import { useMemo, useRef } from 'react';
import { Animated, PanResponder, ScrollView, View, useWindowDimensions } from 'react-native';
import { ProfileCard } from '../../entities/profile-card/ProfileCard.jsx';
import { CardSafetyActions } from '../../features/card-safety/CardSafetyActions.jsx';
import { useShowMatch } from '../../features/match-moment/MatchMoment.jsx';

/** A swipe counts past this share of the screen width. */
const THRESHOLD = 0.3;

/**
 * The deck. Drag the top card right to like or left to pass (a transform-only animation; one
 * driver for the whole gesture, as React Native requires); the Like and Pass buttons, and the
 * card's accessibility actions, do the same for keyboard and screen-reader users. Cards leave at once; a failed swipe brings the card back.
 */
export function DeckWidget() {
  const { space } = useTheme();
  const { width } = useWindowDimensions();
  const deck = useDeck();
  const showMatch = useShowMatch();
  const swipe = useSwipe({
    onMatch: ({ matchId, card }) => showMatch({ matchId, conversationId: matchId, user: card }),
  });
  const current = deck.current;
  const x = useRef(new Animated.Value(0)).current;
  const latest = useRef({ current, swipe });
  latest.current = { current, swipe };

  /** @param {'like' | 'pass'} direction */
  const fling = (direction) => {
    const card = latest.current.current;
    if (!card) return;
    Animated.timing(x, {
      toValue: direction === 'like' ? width * 1.5 : -width * 1.5,
      duration: 180,
      useNativeDriver: false,
    }).start(() => {
      x.setValue(0);
      void (direction === 'like'
        ? latest.current.swipe.like(card)
        : latest.current.swipe.pass(card));
    });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
        onPanResponderRelease: (_e, g) => {
          if (g.dx > width * THRESHOLD) fling('like');
          else if (g.dx < -width * THRESHOLD) fling('pass');
          else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
        },
      }),
    // `fling` reads the latest card and swipe through a ref, so the responder is built once.
    [width, x],
  );

  if (deck.isLoading) return <Skeleton height={420} />;
  if (deck.isError || !current) {
    const incomplete = /** @type {any} */ (deck.error)?.code === 'PROFILE_INCOMPLETE';
    return (
      <EmptyState
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
    );
  }
  const rotate = x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ['-12deg', '0deg', '12deg'],
  });
  return (
    <ScrollView contentContainerStyle={{ padding: space[4], gap: space[3] }}>
      <Animated.View
        key={current.userId}
        {...pan.panHandlers}
        accessibilityActions={[
          { name: 'like', label: t('deck.like') },
          { name: 'pass', label: t('deck.pass') },
        ]}
        onAccessibilityAction={(event) =>
          fling(event.nativeEvent.actionName === 'like' ? 'like' : 'pass')
        }
        style={{ transform: [{ translateX: x }, { rotate }] }}
      >
        <ProfileCard
          card={current}
          badges={
            <Slot name="deck.cardBadges" render={(item) => <item.component card={current} />} />
          }
          actions={<CardSafetyActions user={current} />}
        />
      </Animated.View>
      <View style={{ flexDirection: 'row', gap: space[3], justifyContent: 'center' }}>
        <Button variant="secondary" title={t('deck.pass')} onPress={() => fling('pass')} />
        <Button title={t('deck.like')} onPress={() => fling('like')} />
      </View>
    </ScrollView>
  );
}
