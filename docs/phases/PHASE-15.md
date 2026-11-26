## Phase 15 — Deployment, observability and closed beta launch: Start Plan

**Status of prerequisites:** Phases 1–14 approved ✅ (`docs/phases/PHASE-01.md` …
`PHASE-14.md`).

- **Beta hosting:** decided in ADR 0028.
  - API: Render Standard
  - Postgres: Render Basic-1gb
  - Redis: Render Key Value Starter
- **Normal per-phase rules apply.** I build nothing until "Approved: start Phase 15". After the
  report I stop.

**What I will build in this phase:**

Each step says what it needs from you. Steps marked "builds now" need nothing.

1. **Deploy configuration (builds now):**
   - **`render.yaml` (Blueprint):** two environments, staging and production.
     - Per environment: a web service, a Postgres, a Key Value, and a nightly backup Cron Job.
     - Every secret is declared `sync: false`, so you type it into Render and it never
       appears in git.
   - **Image settings:**
     - `ROLE=all`
     - a 30 s stop timeout (the app drains for 25 s)
     - health check `/health`; readiness `/ready`
   - **Image trim** (the Phase 15 note): the image is 545 MB today. I will remove dev-only
     files and look at OpenTelemetry's auto-instrumentations, and report before and after.
   - **The image gains `postgresql-client`,** for the backup job.
   - **OpenTelemetry auto-instrumentation** loads through
     `--import @opentelemetry/auto-instrumentations-node/register`, so ESM libraries are traced.
     The Phase 4 note asked for this.
2. **CI/CD** (`.github/workflows/deploy.yml`; builds now, runs once the GitHub secrets exist):
   - **On merge to `main`,** in this order:
     1. build and test (the existing CI)
     2. deploy to staging through Render's deploy hook
     3. wait for `/ready`; migrations run as Render's pre-deploy command (expand step)
     4. run the production smoke suite against staging
     5. run one Playwright flow against staging
   - **Production:** a manual "Promote to production" job in a GitHub environment, which needs
     your approval. It promotes the image already tested on staging.
   - **Rollback:** an error-rate check runs for 10 minutes after deploy. If the API's 5xx rate
     goes over 2%, the job redeploys the previous image through Render's API. The old instance
     drains its sockets for 25 s before stopping.
   - **Web:** `apps/web` and `apps/admin` build and deploy to Cloudflare Pages. Staging goes to
     preview URLs; production deploys on promotion.
   - **Rehearsal:** a rollback is rehearsed on staging.
3. **Environments (builds now):**
   - Staging and production differ only in environment variables, validated by
     `contracts/env.js`.
   - **Staging:** the synthetic seed only, never production data.
   - **`scripts/gen-secrets.js`** (new): run on your own computer, it prints fresh values for
     every generated secret. You paste them into Render. They never pass through me or git.
4. **Web, admin and landing:**
   - **Builds now:** `VITE_API_BASE` (the API's own origin), `CORS_ORIGINS`, and the refresh
     cookie scoped to the API host. The web app and the API are on the same site, so
     `SameSite=Strict` still works.
   - **Admin:** on its own subdomain. A Cloudflare WAF rule allows only `ADMIN_IP_ALLOWLIST`,
     and the API enforces the same list.
   - **Landing page:** real content, Open Graph tags, and links to the privacy notice and the
     terms. The structure builds now; the final text **needs your legal and brand items
     (C1–C4)**.
5. **Storage and CDN (needs R2, B4):**
   - an R2 bucket per environment
   - the 1-day lifecycle rule on `uploads/`
   - CORS for the web origin
   - the `cdn.` custom domain, with a WAF rule that serves `photos/` only (private ID-card
     images live in the same bucket and must never be public)
   - test the storage adapter against real R2
6. **Email, captcha, moderation and push (needs B5–B8):**
   - Resend: domain verification (SPF, DKIM, DMARC)
   - Turnstile, on web and mobile
   - Rekognition in `ap-south-1`: confirm `DetectModerationLabels` and `DetectFaces` work
     there and record the current pricing (the Phase 7 note)
   - Expo push with an access token
   - each tested once against the real service, as the Phase 5 and 6 notes asked
7. **Observability (needs B9 and B10):**
   - **Sentry** for the API, web, admin and mobile, with release tracking. Source maps are
     uploaded in CI.
   - **OpenTelemetry traces** are exported over OTLP to Grafana Cloud.
   - **Metrics: Grafana Cloud's "Metrics Endpoint" scrape job.** It reads
     `/internal/metrics` on the API, protected by a bearer token
     (`METRICS_SCRAPE_TOKEN`). Today metrics are served only on the internal port, which
     Render does not expose. This needs no new package.
   - **New gauges for the alerts:** outbox lag, dead-letter count, oldest job per queue, and
     backup age.
   - **Dashboards** (as code, in `infra/grafana/`): one per module, plus a system overview.
   - **Alerts** to your contact point:
     - API error rate above 2% for 5 minutes
     - outbox lag above 60 s
     - a non-empty dead-letter queue
     - Redis memory above 70%
     - a backup older than 26 hours
     - any free-tier quota above 80%
     - overload sheds (`vouch_shed_total`)
   - A test alert is fired to you.
8. **Backups and restore (builds now; runs once R2 and Render exist):**
   - A nightly Render Cron Job runs `scripts/backup.js`: it pipes `pg_dump` into R2 under a
     private `backups/` prefix, keeps 14 days, and records the backup age for the alert.
   - Render's own daily backups stay on as a second copy.
   - A restore drill into a scratch database, timed and recorded in `docs/runbooks/restore.md`.
9. **Faster event delivery** (the Phase 6 note): photo approval waits up to about 4 s on an
   idle system.
   - The relay will also wake on Postgres `LISTEN/NOTIFY` from the outbox insert, keeping the
     poll as a fallback.
   - Measured before and after, with a test that fails before the change.
10. **Beta controls (builds now; campus details need C5):**
    - **Invite-only access (additive contract):**
      - an optional `inviteCode` at sign-up
      - a `beta.inviteOnly` flag per college
      - invite codes stored hashed, with an optional use limit and expiry
      - an admin command to create them
    - **`scripts/college-add.js`:** adds a launch college and its cluster with its email
      domains. Run by you or by me against staging.
    - **Moderator accounts:** you create them yourself with `admin:create` in the Render shell,
      and scan the TOTP code on your phone. The secret is printed only to you.
11. **Mobile release (needs B11–B13):**
    - **`apps/mobile/eas.json`:** development, preview (internal testing and TestFlight) and
      production profiles.
    - **`app.config.js`:**
      - `apiUrl` per profile
      - OTA update channels `staging` and `production`
      - bundle id and package
      - icons and splash, once you send them (C4)
    - **Builds:** Android to the internal testing track, iOS to TestFlight.
    - **Store basics:** the privacy labels / data safety answers drafted for your review.
12. **Docs:**
    - `docs/infrastructure.md`: every resource, what it is for, its plan and its cost, and
      where its secrets live (by name, never the value)
    - `docs/OPERATIONS.md`: deploy, roll back, read dashboards, handle each alert, restore,
      rotate keys, add a campus, step the API down (ADR 0028)
    - `docs/runbooks/launch-checklist.md`
13. **Launch** (needs everything above):
    - the production smoke suite
    - a real sign-up on web, Android and iOS
    - a real match and chat between two test accounts
    - a push received
    - a report processed in admin
    - a test alert received
    - Gateway memory per socket is re-measured on Render (the Phase 9 note).
    - **Production opens for the first campus,** behind invite-only access.

**What I will NOT build (out of scope):**

- New features
- Growth-stage scaling: role split, replicas, a pooler
- The post-launch socket-load shedding follow-up
- Store submission for public release: internal testing and TestFlight only
- Final legal text: I flag it; you supply it after legal review

**Files and modules I expect to create or modify:**

- **Deploy and CI:** `render.yaml`, `.github/workflows/deploy.yml`, `Dockerfile`
- **Scripts:** `scripts/gen-secrets.js`, `apps/api/scripts/{backup,college-add,invite-create}.js`
- **API platform:** `apps/api/src/platform/{metrics,http,boot,events/relay}.js`
- **Contracts and identity (invite codes):** `packages/contracts/src/{env.js,http/identity.js}`,
  `apps/api/src/modules/identity/**`, plus a migration
- **Web and admin:** `apps/web/src/shared/config`, `apps/admin/src/shared/config`, and
  `wrangler.toml` / Pages config
- **Landing:** `apps/landing/**`
- **Mobile:** `apps/mobile/{eas.json,app.config.js}` (replacing `app.json`)
- **Grafana:** `infra/grafana/**` (dashboards and alert rules as JSON)
- **Docs:** `docs/infrastructure.md`, `docs/OPERATIONS.md`,
  `docs/runbooks/{launch-checklist,restore}.md`, ADRs as needed

**New dependencies (need approval), exact versions at least two weeks old:**

- `wrangler`: dev dependency, deploys Pages from CI
- `eas-cli`: dev dependency, EAS builds from CI
- `@sentry/react` and `@sentry/react-native`: the browser and mobile Sentry SDKs (the API
  already has `@sentry/node`)
- `@sentry/vite-plugin`: dev dependency, source maps
- No metrics package: Grafana scrapes our endpoint.

**Decisions I need from you before starting:**

1. **Name and domain.** "Vouch" is a working name (Before launch list). Which domain should I
   plan DNS for? _My recommendation:_ buy it on Cloudflare Registrar, so DNS, WAF, R2 and
   Pages are in one account. The plan uses these subdomains:
   - `example.app` for the landing page
   - `app.` for the web app
   - `admin.` for the admin console
   - `api.` for the API
   - `cdn.` for photos
   - `mail.` for email
   - the same set under `staging.`
2. **Staging size.** _My recommendation:_ the smallest paid plans, at about $13 a month:
   - Starter web service
   - Basic-256mb Postgres
   - free Key Value

   Staging has no SLO, and it is still always on and safe for CI.

3. **Email provider.** _My recommendation:_ Resend (already integrated and tested with fakes)
   over Brevo.
4. **Observability.** _My recommendation:_ Sentry Developer (free) and Grafana Cloud Free.
   Both fit the beta, and the "quota above 80%" alert watches their limits.
5. **First campus and access.** Which college? Its email domain(s)? Invite codes on top of the
   domain allowlist, which the roadmap asks for? _My recommendation:_ yes, one code per
   cohort, with a use limit.

**How I will verify it:**

- the production smoke suite: health, readiness, config, a sign-up with a real Resend email,
  deck, match, chat, push
- one Playwright flow against staging on every deploy
- a rollback rehearsed on staging, with logs
- the restore drill, timed
- a test alert received by you
- dashboard screenshots
- the launch checklist fully ticked
- the actual monthly bill broken down
- every code change with tests and green CI, as in earlier phases

**Branch:** `claude/lucid-rubin-foq2uj` (ADR 0002), restarted from `main` after PR #10.

---

### Owner setup checklist

**How to send me things:**

- **Secrets:** never in chat, email or git. You type each secret straight into the host's
  secret settings: Render → service → Environment, or GitHub → Settings → Secrets and
  variables → Actions.
- **Non-secret values:** reply with them in chat (account ids, public keys, project ids, DSNs,
  domains).
- **Generated secrets:** run `node scripts/gen-secrets.js` on your own computer (I'll add it in
  step 3). Paste each printed value into Render, then close the terminal.

**Order:** the items with long lead times (A2, A3) come first, because store approval can take
days. The rest follow in dependency order. **Blocks** says which plan steps wait for the item.

#### A. Start now (long lead times)

| #   | Item                                   | Where to go and what to do                                                                                                                                                                                                         | Send me                                                   | Secret, and where it goes                                                                                                   | Blocks                                                |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A1  | **Domain**                             | Cloudflare dashboard → Domain Registration → Register Domains → buy the name (or add an existing domain and change its nameservers to Cloudflare).                                                                                 | The domain                                                | —                                                                                                                           | Steps 4–7 and 11–13 (DNS, email, CDN, Turnstile, web) |
| A2  | **Apple Developer Program** ($99/year) | developer.apple.com → Account → Enroll. An individual is quickest; an organisation needs a D-U-N-S number and can take a week. Then App Store Connect → Apps → + → New App, with bundle id `app.<domain>.vouch` (I'll confirm it). | Team ID (Membership page); app name; bundle id            | Later, run `eas credentials` yourself: it signs in to Apple and stores the APNs key and certificates in Expo, never with me | Step 11 (iOS / TestFlight)                            |
| A3  | **Google Play Console** ($25 once)     | play.google.com/console → create the developer account; identity verification can take days. Then Create app → set up the Internal testing track.                                                                                  | Developer account name; package name `app.<domain>.vouch` | —                                                                                                                           | Step 11 (Android)                                     |

#### B. Accounts and keys (after A1)

| #   | Item                                            | Where to go and what to do                                                                                                                                                                                                                                                           | Send me                                                                      | Secret, and where it goes                                                                                                                                                                                                               | Blocks                                  |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| B1  | **GitHub environments**                         | Repo → Settings → Environments → create `staging` and `production`. On `production`, add yourself under Required reviewers.                                                                                                                                                          | "Done"                                                                       | —                                                                                                                                                                                                                                       | Step 2 (promotion approval)             |
| B2  | **Render account**                              | render.com → sign up with GitHub → Workspace → add billing → connect the GitHub repo. When I've merged `render.yaml`: New → Blueprint → choose the repo.                                                                                                                             | Workspace name                                                               | Each service's Environment tab: paste every `sync: false` secret listed in `docs/infrastructure.md` (generated ones from `gen-secrets.js`, the others from B4–B10)                                                                      | Steps 1–3, 8 and 13 (anything deployed) |
| B3  | **Render deploy hooks**                         | Each web service (staging, production) → Settings → Deploy Hook → copy it. Account → API Keys → create one for the rollback job.                                                                                                                                                     | —                                                                            | GitHub → `staging` environment secret `RENDER_DEPLOY_HOOK`; `production` environment secret `RENDER_DEPLOY_HOOK`; repository secret `RENDER_API_KEY`                                                                                    | Step 2 (CD)                             |
| B4  | **Cloudflare R2**                               | Dashboard → R2 → enable (needs a payment method; free tier) → create buckets `vouch-staging` and `vouch-prod` → Manage R2 API Tokens → Create token: Object Read & Write, limited to those two buckets.                                                                              | Account ID (R2 overview); bucket names; the S3 endpoint URL                  | Render: `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in each environment (separate tokens per environment are better)                                                                                                                  | Steps 5 and 8 (photos, backups)         |
| B5  | **Cloudflare API token for Pages**              | My Profile → API Tokens → Create → template "Edit Cloudflare Workers" or a custom token with Account › Cloudflare Pages › Edit.                                                                                                                                                      | Account ID                                                                   | GitHub repository secret `CLOUDFLARE_API_TOKEN`                                                                                                                                                                                         | Step 4 (web deploy)                     |
| B6  | **Turnstile**                                   | Dashboard → Turnstile → Add widget: one for staging hostnames, one for production; Managed mode.                                                                                                                                                                                     | Both **site keys** (public)                                                  | Render: `TURNSTILE_SECRET_KEY` per environment                                                                                                                                                                                          | Steps 4 and 6 (sign-up captcha)         |
| B7  | **Resend**                                      | resend.com → sign up → Domains → Add `mail.<domain>` → it shows SPF, DKIM and DMARC records → add them in Cloudflare DNS (DNS only, grey cloud) → Verify. Then API Keys → create a "Sending access" key for that domain.                                                             | "Verified"; the from-address you want (for example `no-reply@mail.<domain>`) | Render: `RESEND_API_KEY` (one key per environment is better)                                                                                                                                                                            | Step 6 (OTP emails, staff alerts)       |
| B8  | **AWS for Rekognition**                         | aws.amazon.com → create an account → IAM → Users → Create `vouch-moderation` → attach an inline policy allowing **only** `rekognition:DetectModerationLabels` and `rekognition:DetectFaces` → Security credentials → Create access key. Set a monthly budget alert in Billing.       | Region `ap-south-1` (confirm)                                                | Render: `MODERATION_AWS_ACCESS_KEY_ID` and `MODERATION_AWS_SECRET_ACCESS_KEY`                                                                                                                                                           | Step 6 (photo moderation)               |
| B9  | **Sentry**                                      | sentry.io → create the org → Projects → create `api` (Node), `web` (React), `admin` (React), `mobile` (React Native). Then Settings → Auth Tokens → create an org token (project:releases, org:read).                                                                                | The four DSNs (not secret)                                                   | GitHub secret `SENTRY_AUTH_TOKEN`                                                                                                                                                                                                       | Step 7 (errors, releases)               |
| B10 | **Grafana Cloud**                               | grafana.com → create a free stack. In the stack: Connections → OpenTelemetry (OTLP) → note the endpoint and instance id → generate a token. Alerting → Contact points → add your email (and phone, if you want SMS through an integration).                                          | OTLP endpoint URL; instance id; stack URL                                    | Render: `OTEL_EXPORTER_OTLP_HEADERS` (I give you its exact format); later, the scrape job's bearer token, which you paste into Grafana's Metrics Endpoint integration and into Render as `METRICS_SCRAPE_TOKEN` (from `gen-secrets.js`) | Step 7 (traces, metrics, alerts)        |
| B11 | **Expo**                                        | expo.dev → sign up → create project `vouch`. Account settings → Access tokens → create a robot token for CI. Project → Credentials → Push: create an Expo push access token.                                                                                                         | Project ID; account (owner) name                                             | GitHub secret `EXPO_TOKEN`; Render: `EXPO_ACCESS_TOKEN`                                                                                                                                                                                 | Step 11 (builds), step 6 (push)         |
| B12 | **iOS push credentials** (after A2 and B11)     | On your computer: `npx eas-cli@<pinned> credentials` → iOS → production → let EAS create the APNs key and distribution certificate (it signs in to Apple).                                                                                                                           | "Done"                                                                       | Stored by Expo                                                                                                                                                                                                                          | Step 11 (iOS push)                      |
| B13 | **Android push credentials** (after A3 and B11) | console.firebase.google.com → Add project → add an Android app with the package name → Project settings → Service accounts → Generate new private key (a JSON file). Upload it with `eas credentials` → Android → FCM V1 service account key. Delete the downloaded file afterwards. | "Done"                                                                       | Stored by Expo                                                                                                                                                                                                                          | Step 11 (Android push)                  |

#### C. Content and people (any time before launch)

| #   | Item                                       | What I need                                                                                                                                                              | Blocks                                              |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| C1  | **Company identity and grievance officer** | Legal name and registered address; the grievance officer's name and a monitored address (for example `grievance@<domain>`); a support address. Not secret: send in chat. | Step 4 (landing, notice), step 13 (launch)          |
| C2  | **Privacy notice after legal review**      | Your lawyer's edits to `packages/i18n/src/privacy-notice.js` (`2026-11-draft`). I publish it as a final version and switch `PRIVACY_NOTICE_VERSION`.                     | Step 13 (launch)                                    |
| C3  | **Terms of service**                       | The text, from your lawyer. I add a version and acceptance at sign-up.                                                                                                   | Step 13 (launch)                                    |
| C4  | **Brand assets**                           | Final name; app icon (1024×1024 PNG, no transparency); splash image; logo (SVG); one-line description for the stores and the landing page.                               | Steps 4 and 11                                      |
| C5  | **First campus**                           | College name and city; its student email domain(s); expected number of testers; whether invite codes are on; the moderators' names and email addresses.                  | Step 10 (seed and invites)                          |
| C6  | **Admin access**                           | The public IP addresses (or VPN egress) staff will use for the admin console.                                                                                            | Step 4 (admin WAF), production `ADMIN_IP_ALLOWLIST` |
| C7  | **Test devices**                           | One Android phone and one iPhone tester added in Play Console (internal testers) and TestFlight.                                                                         | Step 13 (real sign-up per platform)                 |

**What I can build before you provide anything:**

- `render.yaml` and the deploy workflow
- the image changes: trim, `pg_dump`, OTel register, 30 s stop
- `gen-secrets.js`, `backup.js`, `college-add.js`
- invite codes with their tests
- `LISTEN/NOTIFY` delivery
- the metrics endpoint and the new alert gauges
- Grafana dashboards and alert rules as code
- `eas.json` and `app.config.js` (with placeholder ids)
- the web API-origin configuration
- the landing page structure
- `docs/infrastructure.md`, `docs/OPERATIONS.md` and the launch checklist

All of it runs against the local stack and CI. Deployment, real-service tests, the restore
drill, alerts and store builds wait for the items marked above.

**Expected monthly cost** (list prices, confirmed from the actual bill in the report):

- **Production:** about $54 a month. Render Standard $25 + Postgres Basic-1gb $19 + Key Value
  Starter $10.
- **Staging:** about $13 a month.
- **Backup cron:** about $1.
- **Free tiers:** Cloudflare (R2, Pages, DNS, WAF, Turnstile), Resend, Sentry, Grafana Cloud
  and Expo.
- **Usage-based:** Rekognition is about $1 per 1,000 photos.
- **Yearly or one-off:** the domain at about $10–15 a year, Apple at $99 a year, Google Play at
  $25 once.

That is above the roadmap's $25–40 estimate because of the ADR 0028 plan.

➡️ Reply "Approved: start Phase 15" to begin, or tell me what to change. Please also answer
the five decisions above and start items A1–A3.
