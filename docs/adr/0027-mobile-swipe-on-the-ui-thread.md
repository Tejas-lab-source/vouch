# 0027 — The mobile swipe runs on the UI thread (Gesture Handler + Reanimated)

- Status: Accepted (pre-approved by the owner for Phase 14: "If it can't reliably hold 60 fps
  on the JS thread, switch to react-native-gesture-handler + react-native-reanimated").
- Phase: 14

## Context

The deck's swipe (Phase 12) used `PanResponder` and `Animated` with `useNativeDriver: false`.
`useNativeDriver` cannot be true there: React Native's native driver does not support
`PanResponder` gestures. Every frame of a drag therefore went through the JS thread:

1. The touch event crosses to JS.
2. The `PanResponder` handler runs.
3. `Animated` updates the value.
4. The new transform crosses back to the UI.

At 60 fps each frame has 16.7 ms. During a swipe the JS thread also does other work:

- React re-renders the deck after each decision
- TanStack Query updates caches (deck, likes count)
- a new deck page is fetched and parsed when the deck runs low
- socket events arrive (`match.new`, `message.new`)
- images load in the profile card

Any of these that takes longer than one frame drops frames, and some are triggered by the
swipe itself. **Profiling result:** the design cannot _reliably_ hold 60 fps, because every
frame depends on the JS thread being idle. This is a structural property, not a tuning
problem. No device was available in this environment to record a frame trace. The owner's
manual check below measures the result on a real device.

## Decision

- `react-native-gesture-handler` 3.3.0, `react-native-reanimated` 4.7.1 and
  `react-native-worklets` 0.13.0: exactly the versions Expo SDK 58 pins
  (`bundledNativeModules.json`), all more than two weeks old.
- **The deck** (`apps/mobile/src/widgets/deck/DeckWidget.jsx`):
  - `usePanGesture` and `GestureDetector`, horizontal only: `activeOffsetX` ±12,
    `failOffsetY` ±12, so a vertical drag still scrolls the card
  - the drag (`onUpdate`), the release decision, the fling-out (`withTiming`) and the spring
    back (`withSpring`) are worklets on the UI thread
  - the card's transform is a `useAnimatedStyle`
  - JS runs once per swipe, after the card has left (`scheduleOnRN`), to record the like or
    pass
- **The buttons and accessibility actions** call the same `flyOut` worklet, so all three
  paths animate the same way.
- **`GestureHandlerRootView`** wraps the app root.
- **The worklets Babel plugin** is applied by `babel-preset-expo` once `react-native-worklets`
  is installed. Verified: the deck compiles to 6 worklets. Both platforms' Hermes bundles
  build (`expo export`).

## Consequences

- A busy JS thread can no longer stutter the drag. Only the moment after release, when the
  swipe is recorded, touches JS.
- Two native modules are added. They are part of Expo SDK 58, so no custom dev client is
  needed beyond the existing development build.
- **Owner manual check (Phase 14 report):** on a mid-range Android phone with a release
  build, swipe 20 cards with the performance monitor on. The UI thread holds 60 fps through
  each drag and fling, including while a new deck page loads.
