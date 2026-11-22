# Product analytics events (v1)

Phase 12 records a small set of product events through a client `Analytics` port
(`packages/features-core/src/analytics`).

- **v1 adapter:** it only writes a line to the development log (web: `console.debug` in dev
  builds; mobile: `__DEV__`). Nothing is sent anywhere: there is no endpoint and no
  third-party SDK. Adding either needs the owner's approval.
- **No personal data.** Events carry small enums and counts only. `sanitizeProps` drops any
  property that is not on the allow-list below, so a name, an email, another person's id,
  photo URLs or message text can never be recorded by mistake. A unit test covers this.

| Event                       | When                                                       | Properties (allowed values)                            |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `onboarding_step_completed` | a step of onboarding is saved                              | `step`: `basics`, `interestedIn`, `ageRange`, `photos` |
| `onboarding_completed`      | the photos step is confirmed (onboarding done)             | none                                                   |
| `deck_viewed`               | the deck first loads in a session                          | `cards`: number of cards queued                        |
| `swipe`                     | a swipe is accepted by the server                          | `direction`: `like`, `pass`                            |
| `match`                     | a match is shown (once per match, even if both paths fire) | `source`: `swipe`, `socket`                            |

To add an event: add it to `ANALYTICS_EVENTS`, add its properties to the allow-list with fixed
values (or as a number), document it here, and keep it free of personal data.
