# Store privacy answers (draft for the owner's review)

Drafted in Phase 15 (Start Plan step 11) from what the code actually collects, for the App
Store "App Privacy" section and Google Play's "Data safety" form. **The owner reviews and
submits these** (App Store Connect and Play Console; checklist A2 and A3). If the privacy
notice changes after legal review (C2), check these answers again: the two must agree.

Sources checked: `packages/i18n/src/privacy-notice.js` (the notice), the identity, profiles,
media, chat, safety and notifications modules, `@vouch/features-core` monitoring (Sentry,
scrubbed) and `docs/analytics.md` (no analytics leaves the device in v1).

## Facts both stores ask about

- **Tracking / advertising:** none. No ad SDK, no advertising identifier, no data sold or
  shared with data brokers. Product analytics stay on the device in v1.
- **Encryption in transit:** yes, HTTPS and WSS everywhere.
- **Account deletion:** in the app (Settings → Delete my account), and on the web (the landing
  page's "Delete your account" section links to the web app's Settings). Data is erased
  within 30 days; backups age out within 14 days.
- **Service providers** process data only on our instructions (Render, Cloudflare, Resend,
  Expo/Apple/Google push, AWS Rekognition, Sentry, Grafana Labs). Both stores treat this as
  not "sharing".
- **Not collected:** precise or coarse location (photo location data is removed), contacts,
  calendar, health, financial or payment data, browsing or search history, audio, purchases.

## App Store: App Privacy

"Data Used to Track You": **none.**

"Data Linked to You", all for **App Functionality** (and, where marked, also for the stated
purpose):

| Apple data type                        | What it is in Vouch                                                   | Notes                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Contact Info → Email Address           | College email, for the sign-in code                                   | Stored only as a keyed hash; sent to Resend to deliver the code                                                                        |
| Contact Info → Name                    | First name on the profile                                             |                                                                                                                                        |
| Sensitive Info                         | Gender, and who the user is interested in (orientation)               | Required to match people                                                                                                               |
| User Content → Photos or Videos        | Profile photos; optional student-ID image and selfie                  | ID images deleted within 30 days of review. Apple's App Functionality purpose includes fraud prevention, so no other purpose is needed |
| User Content → Emails or Text Messages | Chat messages between matches                                         |                                                                                                                                        |
| User Content → Other User Content      | Bio, profile sections, reports filed                                  |                                                                                                                                        |
| Identifiers → User ID                  | The account's public id                                               |                                                                                                                                        |
| Identifiers → Device ID                | The push token of each signed-in device                               | Conservative: push tokens identify a device                                                                                            |
| Usage Data → Product Interaction       | Likes, passes, matches, blocks                                        | The app's core function                                                                                                                |
| Other Data Types                       | Date of birth (18+ check), college, graduation year, invite code used | DOB has no Apple category of its own                                                                                                   |

"Data Not Linked to You":

| Apple data type          | What it is                                                                 | Purpose           |
| ------------------------ | -------------------------------------------------------------------------- | ----------------- |
| Diagnostics → Crash Data | Sentry crash and error reports, without user, email, token or message text | App Functionality |

Not declared: "Performance Data" (Sentry tracing is off: `tracesSampleRate: 0`) and
"Analytics" (nothing is sent).

Other App Store answers:

- **Age rating:** 17+ (frequent/intense mature or suggestive themes: no; but dating and
  user-generated content between strangers). The app also requires 18+ at sign-up.
- **User-generated content (guideline 1.2):** the app has reporting, blocking, a moderation
  queue with staff review, photo moderation before photos are shown, and the support contact
  (C1) in the app. Say so in the review notes.
- **Sign-in for App Review:** the reviewer needs a working account. Create a dedicated
  invite code and a review account on a test college domain whose OTP you can read, and give
  the steps in the review notes. (Never reuse a real student's account.)
- **Export compliance:** `usesNonExemptEncryption: false` (standard HTTPS only), already set
  in `app.config.js`.

## Google Play: Data safety

- Does the app collect or share user data? **Collects: yes. Shares: no.**
- Is all data encrypted in transit? **Yes.**
- Can users request deletion? **Yes**, in the app and at the web link (the landing page's
  "Delete your account" section).

| Play category → type                        | Collected | Required?                                         | Purposes                                                                                         |
| ------------------------------------------- | --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Personal info → Email address               | Yes       | Required                                          | Account management; Fraud prevention, security and compliance                                    |
| Personal info → Name                        | Yes       | Required                                          | App functionality                                                                                |
| Personal info → User IDs                    | Yes       | Required                                          | App functionality; Account management                                                            |
| Personal info → Sexual orientation          | Yes       | Required                                          | App functionality                                                                                |
| Personal info → Other info                  | Yes       | Required                                          | App functionality; Fraud prevention (18+ check). Gender, date of birth, college, graduation year |
| Photos and videos → Photos                  | Yes       | Required (profile); optional (ID card and selfie) | App functionality; Fraud prevention, security and compliance                                     |
| Messages → Other in-app messages            | Yes       | Optional (only if the user chats)                 | App functionality                                                                                |
| App activity → App interactions             | Yes       | Required                                          | App functionality (likes, passes, matches, blocks)                                               |
| App activity → Other user-generated content | Yes       | Optional                                          | App functionality; Fraud prevention (bio, profile sections, reports)                             |
| App info and performance → Crash logs       | Yes       | Required (automatic)                              | App functionality                                                                                |
| App info and performance → Diagnostics      | Yes       | Required (automatic)                              | App functionality (error details, app version)                                                   |
| Device or other IDs                         | Yes       | Required                                          | App functionality (push notifications)                                                           |

"Processed ephemerally": the email address is used to send the code and kept only as a hash;
answer **No** (it is still stored, in hashed form).

Other Play answers:

- **Target audience:** 18 and over only. Not designed for children.
- **Content rating (IARC):** a dating app with user interaction and user-generated content;
  expect a Mature rating.
- **Ads:** the app contains no ads.
- **Account deletion URL:** `https://<domain>/#delete-account` (the landing page section).

## To fill in once known

- The domain (A1) in the deletion URL and the support address (C1).
- The final app name and bundle id or package (C4); today `app.vouch.mobile`.
- The App Review account and invite code (created on production just before submission).
