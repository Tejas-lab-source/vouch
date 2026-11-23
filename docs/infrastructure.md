# Infrastructure

Every hosted resource Vouch uses (Phase 15): what it is for, its plan and cost, and where its
settings and secrets live. Secrets are listed **by name only**. Their values live in the
host's secret settings (Render, GitHub, Expo, Grafana) and never in git, chat or email.

The checklist items (A1, B2, …) refer to the owner setup checklist in
`docs/phases/PHASE-15.md`. Where this file and that checklist differ, this file is current:
see "Changes from the Start Plan" at the end.

Placeholders: `example.app` stands for the owner's domain (checklist A1) until it is known.

## Overview

| Resource                    | Provider                     | Plan (ADR 0028)        | Staging           | Approx. cost / month |
| --------------------------- | ---------------------------- | ---------------------- | ----------------- | -------------------- |
| API (`ROLE=all`, Docker)    | Render web service           | Standard (1 CPU, 2 GB) | Starter (0.5 CPU) | $25 (+ $7 staging)   |
| Postgres 17                 | Render Postgres              | Basic-1gb              | Basic-256mb       | $19 (+ $6 staging)   |
| Redis (BullMQ, rate limits) | Render Key Value             | Starter, `noeviction`  | Free              | $10                  |
| Nightly backup              | Render Cron Job              | Starter                | Starter           | about $1             |
| Web, admin, landing         | Cloudflare Pages             | Free                   | Separate projects | $0                   |
| Photos, ID images, backups  | Cloudflare R2                | Free tier              | Own bucket        | $0 at beta volume    |
| DNS, CDN, WAF, Turnstile    | Cloudflare                   | Free                   | —                 | $0                   |
| Email (OTP, staff alerts)   | Resend                       | Free                   | Same account      | $0                   |
| Photo moderation            | AWS Rekognition `ap-south-1` | Pay per use            | Same IAM user     | about $1 / 1,000     |
| Push                        | Expo Push                    | Free                   | Same project      | $0                   |
| Errors                      | Sentry                       | Developer (free)       | Same projects     | $0                   |
| Traces, metrics, alerts     | Grafana Cloud                | Free                   | Same stack        | $0                   |
| Mobile builds               | Expo EAS                     | Free tier              | `preview` profile | $0                   |

Yearly or one-off: the domain (about $10–15 a year), Apple Developer ($99 a year), Google
Play ($25 once). The report gives the first actual bill.

## Domains and DNS (Cloudflare, A1)

| Host                       | Points to                                 | Proxy    | Notes                                    |
| -------------------------- | ----------------------------------------- | -------- | ---------------------------------------- |
| `example.app`              | Pages project `vouch-landing`             | On       | The landing page                         |
| `app.example.app`          | Pages project `vouch-web`                 | On       | The web app                              |
| `admin.example.app`        | Pages project `vouch-admin`               | On       | WAF rule: only `ADMIN_IP_ALLOWLIST` (C6) |
| `api.example.app`          | Render `vouch-api` (custom domain, CNAME) | **Off**  | Render terminates TLS; WebSockets direct |
| `cdn.example.app`          | R2 bucket `vouch-prod` (custom domain)    | On       | WAF rule: serve `photos/*` only          |
| `staging.example.app` etc. | The staging projects and services         | as above | Same layout with a `staging.` prefix     |
| `mail.example.app`         | Resend (SPF, DKIM, DMARC records)         | Off      | DNS only (grey cloud)                    |

- **The API stays DNS-only** (grey cloud): Render issues its certificate and the socket
  connects directly. `TRUSTED_PROXIES` is then Render's proxy range, not Cloudflare's.
- **The web app and the API are one site** (`example.app`), so the refresh cookie
  (`SameSite=Strict`, host-only on the API) is sent on the API calls the web app makes.
- **The CDN rule matters for privacy:** ID-card images and backups are in the same bucket as
  photos, under private prefixes. The WAF rule must refuse everything outside `photos/`.

## Render (B2, B3)

`render.yaml` is the Blueprint: create it once with **New → Blueprint** and choose the repo.

Services: `vouch-api`, `vouch-backup`, `vouch-kv`, `vouch-db`, and the same with `-staging`.
Deploys are never automatic (`autoDeploy: false`): the Deploy workflow deploys an exact
commit through Render's API.

### API environment (`vouch-api`, `vouch-api-staging`)

Set in Render → service → Environment. `sync: false` means Render asks for the value.

| Name                                                        | Secret      | Source                                                                               |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`, `REDIS_URL`                                 | yes         | Linked by the Blueprint                                                              |
| `JWT_SIGNING_KEYS`, `JWT_ACTIVE_KID`                        | yes         | `node scripts/gen-secrets.js <env>`                                                  |
| `EMAIL_HMAC_SECRET`                                         | yes         | `gen-secrets.js`; **never change it** (see there)                                    |
| `COOKIE_SECRET`                                             | yes         | `gen-secrets.js`                                                                     |
| `ADMIN_TOTP_KEY`                                            | yes         | `gen-secrets.js`; never change it                                                    |
| `METRICS_SCRAPE_TOKEN`                                      | yes         | `gen-secrets.js`; also in Grafana and GitHub                                         |
| `CORS_ORIGINS`                                              | no          | `https://app.example.app,https://admin.example.app`                                  |
| `CDN_BASE_URL`                                              | no          | `https://cdn.example.app`                                                            |
| `TRUSTED_PROXIES`                                           | no          | Render's proxy CIDRs (confirmed at first deploy)                                     |
| `ADMIN_IP_ALLOWLIST`                                        | no          | C6                                                                                   |
| `R2_ACCOUNT_ID`, `R2_BUCKET`                                | no          | B4                                                                                   |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                  | yes         | B4 (one token per environment)                                                       |
| `EMAIL_FROM`, `ADMIN_ALERT_EMAIL`                           | no          | B7, C1                                                                               |
| `RESEND_API_KEY`                                            | yes         | B7                                                                                   |
| `TURNSTILE_SECRET_KEY`                                      | yes         | B6                                                                                   |
| `EXPO_ACCESS_TOKEN`                                         | yes         | B11                                                                                  |
| `MODERATION_AWS_ACCESS_KEY_ID`                              | yes         | B8                                                                                   |
| `MODERATION_API_KEY`                                        | yes         | B8: **the AWS secret access key**                                                    |
| `SENTRY_DSN`                                                | no          | B9 (the `api` project)                                                               |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | header: yes | B10: `Authorization=Basic%20<base64 of instance-id:token>` (the space written `%20`) |

Values fixed in `render.yaml`: `NODE_ENV=production`, `DEPLOY_ENV`, `ROLE=all`, the
providers (`resend`, `turnstile`, `expo`, `rekognition`), `MODERATION_AWS_REGION=ap-south-1`,
`PRIVACY_NOTICE_VERSION` and `OTEL_RESOURCE_ATTRIBUTES`.

### Backup job (`vouch-backup`, `vouch-backup-staging`)

`node scripts/backup.js` nightly (02:47 IST production, 03:17 IST staging). It needs
`DATABASE_URL` (linked) and the four `R2_*` values. Retention: 14 days in production, 7 in
staging. Each run records a row in `platform.backup_runs`, which the backup-age alert reads.
Render's own daily Postgres backups stay on as a second copy.

### The database login and the module roles

Render gives one login that owns the database. The migrations (the pre-deploy command)
create the NOLOGIN module roles and then grant each one to that login `WITH SET TRUE,
INHERIT FALSE`, so the app can `SET ROLE vouch_<module>` per transaction. This was tested
with a non-superuser `CREATEROLE` login (`test/db/hosted-login.integration.test.js`).

- **To confirm at the first staging deploy:** that Render's login has `CREATEROLE`. If it
  does not, the first migration fails with "permission denied to create role", nothing is
  deployed, and the roles must be created once by Render support or a superuser.

### Deploying from GitHub (B3, corrected)

The workflow calls Render's REST API with an API key and service ids (instead of deploy
hooks), so it can deploy an exact commit and roll back to a recorded deploy.

- Render → Account settings → API Keys → create one. It goes into both GitHub environments
  as the secret `RENDER_API_KEY`.
- Each service's id (`srv-…`, in its URL and Settings) goes into the GitHub variables below.
- **To confirm at the first staging deploy:** the deploy, status and rollback endpoints
  (`scripts/render-deploy.js`). Render's docs were not reachable from the build sandbox; the
  client accepts both list shapes and stops on any unknown failure.

## GitHub (B1)

Two environments, `staging` and `production`. `production` has the owner as a required
reviewer: every promotion waits for approval.

| Name                                                                | Kind     | Per environment | What                                                  |
| ------------------------------------------------------------------- | -------- | --------------- | ----------------------------------------------------- |
| `RENDER_API_KEY`                                                    | secret   | both            | B3                                                    |
| `CLOUDFLARE_API_TOKEN`                                              | secret   | both            | B5 (Pages: Edit)                                      |
| `SENTRY_AUTH_TOKEN`                                                 | secret   | both            | B9 (uploads source maps)                              |
| `METRICS_SCRAPE_TOKEN`                                              | secret   | both            | The same value as the API's; the post-deploy watch    |
| `RENDER_SERVICE_ID`, `RENDER_BACKUP_SERVICE_ID`                     | variable | each its own    | `srv-…` ids                                           |
| `API_URL`, `WEB_URL`, `ADMIN_URL`, `SITE_URL`                       | variable | each its own    | `https://` origins                                    |
| `CDN_URL`, `UPLOAD_ORIGIN`                                          | variable | each its own    | The CDN; `https://<account>.r2.cloudflarestorage.com` |
| `CLOUDFLARE_ACCOUNT_ID`                                             | variable | both            | B4                                                    |
| `PAGES_PROJECT_WEB`, `PAGES_PROJECT_ADMIN`, `PAGES_PROJECT_LANDING` | variable | each its own    | for example `vouch-web-staging`, `vouch-web`          |
| `SENTRY_ORG`, `SENTRY_INGEST`                                       | variable | both            | B9; the ingest origin (`https://o….ingest.sentry.io`) |
| `SENTRY_DSN_WEB`, `SENTRY_DSN_ADMIN`                                | variable | both            | B9 (DSNs are public)                                  |
| `TURNSTILE_SITE_KEY`                                                | variable | each its own    | B6 (public)                                           |
| `GRIEVANCE_EMAIL`                                                   | variable | both            | C1                                                    |

`PAGES_PROJECT_LANDING` is optional on staging.

## Cloudflare (B4, B5, B6)

- **R2:** buckets `vouch-staging` and `vouch-prod`.
  - Lifecycle: delete `uploads/` after 1 day.
  - CORS: `PUT` from the web origin only (`node scripts/storage-init.js` applies it).
  - Prefixes: `photos/` (public through the CDN), `uploads/`, `id-cards/` (private, deleted
    within 30 days), `backups/<env>/` (private).
- **Pages:** projects `vouch-web`, `vouch-admin`, `vouch-landing`, and the `-staging` ones.
  Each deploy gets the headers from `scripts/pages-headers.js`: a CSP that names only the
  API, the CDN, R2 uploads, Turnstile and Sentry; HSTS; and no indexing for admin.
- **WAF:** the admin IP rule, and the CDN `photos/` rule.
- **Turnstile:** one widget per environment. The site key is a GitHub variable; the secret
  key is in Render.

## Resend (B7), AWS (B8), Expo (B11–B13)

- **Resend:** the `mail.example.app` domain verified (SPF, DKIM, DMARC). One sending key per
  environment.
- **AWS:** IAM user `vouch-moderation`, allowed only `rekognition:DetectModerationLabels` and
  `rekognition:DetectFaces`, with a monthly budget alert.
- **Expo:**
  - project `vouch`; `eas.json` profiles `development`, `preview` (staging) and
    `production`, chosen by `APP_VARIANT` in `app.config.js`
  - EAS environment variables (public): `VOUCH_API_URL`, `SENTRY_DSN`, `EAS_PROJECT_ID`,
    `EAS_OWNER`, `SENTRY_ORG`
  - EAS secret: `SENTRY_AUTH_TOKEN`
  - push credentials (APNs key, FCM V1 key) are stored by Expo
  - bundle id and package: `app.vouch.mobile` (`.staging` for preview builds). Change them
    before the first store build if the brand differs (C4).

## Observability (B9, B10)

- **Sentry projects:** `vouch-api`, `vouch-web`, `vouch-admin`, `vouch-mobile`. Personal
  data is scrubbed on the device (`@vouch/features-core` monitoring) and in the API.
- **Grafana Cloud:**
  - traces: OTLP from the API (`OTEL_EXPORTER_OTLP_*`)
  - metrics: two Metrics Endpoint scrape jobs, named **`vouch-staging`** and
    **`vouch-production`**. Each scrapes `https://api…/internal/metrics` every 60 s with the
    environment's `METRICS_SCRAPE_TOKEN` as a bearer token. The job name becomes the `job`
    label the dashboards and alerts use.
  - dashboards and alerts: `infra/grafana/` (`node infra/grafana/sync.js`, with a service
    account token in your shell only)
- **Free-tier quotas** (Sentry, Grafana Cloud, Resend, R2, EAS) are watched by each
  vendor's own usage notifications, set to 80% in each console. Their usage is not exported
  as metrics.

## Changes from the Start Plan

- **B3:** a Render API key plus service ids replace the deploy hooks: deploys name an exact
  commit and roll back to a recorded deploy.
- **B8:** the AWS secret access key goes into `MODERATION_API_KEY` (the name the API
  validates), not `MODERATION_AWS_SECRET_ACCESS_KEY`.
- **B5, B9:** the Cloudflare and Sentry tokens are environment secrets (in both
  environments), not repository secrets, so a staging run cannot read production values.
- **New:** the GitHub variables above, `METRICS_SCRAPE_TOKEN` in GitHub, and the Grafana
  scrape job names.
