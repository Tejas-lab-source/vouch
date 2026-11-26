# Launch checklist (closed beta, first campus)

Run top to bottom before opening production to testers (roadmap Phase 15, step 9). Tick each
line with the date and who checked it; paste evidence (a link, a screenshot name, a log line)
in the last column. Nothing here involves pasting a secret anywhere.

Owner checklist items (A1, B2, …) are in `docs/phases/PHASE-15.md`; resources and names are in
`docs/infrastructure.md`.

## 1. Accounts and configuration

| ✓   | Check                                                                                                                                                                    | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| ☐   | Domain on Cloudflare; DNS records as in `docs/infrastructure.md` (API record DNS-only)                                                                                   |          |
| ☐   | Render Blueprint created; every `sync: false` value set, staging and production separately                                                                               |          |
| ☐   | First staging deploy: migrations ran as Render's login (CREATEROLE confirmed), `/ready` is `ready`                                                                       |          |
| ☐   | GitHub environments `staging` and `production` with their secrets and variables; owner is a required reviewer on `production`                                            |          |
| ☐   | R2 buckets, the 1-day `uploads/` lifecycle rule, upload CORS, and the CDN rule serving `photos/` only (check: a `backups/` and an `id-cards/` URL on the CDN return 403) |          |
| ☐   | Pages projects for web, admin and landing, with custom domains; admin WAF allows only `ADMIN_IP_ALLOWLIST` (check from another network: 403)                             |          |
| ☐   | Resend domain verified (SPF, DKIM, DMARC pass in a received email's headers)                                                                                             |          |
| ☐   | Turnstile site keys set; sign-up shows the widget on web and mobile                                                                                                      |          |
| ☐   | Rekognition: one real photo through moderation on staging (approved), and one rejected; pricing noted                                                                    |          |
| ☐   | Sentry: a test error from the API, web, admin and mobile appears with the release and a readable stack (source maps)                                                     |          |
| ☐   | Grafana: both scrape jobs up; traces arrive; `node infra/grafana/sync.js` run                                                                                            |          |
| ☐   | Free-tier usage notifications at 80% set in Sentry, Grafana Cloud, Resend, Cloudflare (R2) and Expo                                                                      |          |
| ☐   | Staging holds only the synthetic seed (no production data)                                                                                                               |          |

## 2. Deploy pipeline

| ✓   | Check                                                                                    | Evidence |
| --- | ---------------------------------------------------------------------------------------- | -------- |
| ☐   | A push to `main` deployed staging; smoke suite and browser checks passed (run link)      |          |
| ☐   | Promotion approved; production deployed the same commit; the 10-minute watch passed      |          |
| ☐   | Rollback rehearsed on staging (`rehearse_rollback`), logs linked                         |          |
| ☐   | Smoke suite passes against production: `node scripts/smoke.js --api … --web … --admin …` |          |

## 3. Backups and alerts

| ✓   | Check                                                                                                   | Evidence |
| --- | ------------------------------------------------------------------------------------------------------- | -------- |
| ☐   | The nightly backup ran in production (`vouch-backup` logs; `vouch_backup_age_seconds` under 26 h)       |          |
| ☐   | Restore drill on Render into a scratch database, timed and logged in `restore.md`                       |          |
| ☐   | Test alert received by the owner (`node infra/grafana/sync.js --test-alert`, then `--clear-test-alert`) |          |
| ☐   | Dashboards show data: overview and one module (screenshots in the report)                               |          |

## 4. The first campus

| ✓   | Check                                                                                                                                            | Evidence |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| ☐   | `college-add.js` run in production for JIIT Noida with its exact student email domain, `--invite-only`                                           |          |
| ☐   | A sign-up without an invite code is refused (`INVITE_CODE_REQUIRED`); with one it succeeds                                                       |          |
| ☐   | Invite codes created (`invite-create.js`) and handed to testers                                                                                  |          |
| ☐   | Moderator accounts created with `admin-create.js`; each signed in with TOTP from an allowed IP                                                   |          |
| ☐   | Privacy notice: the legally reviewed version is published and `PRIVACY_NOTICE_VERSION` points at it (C2)                                         |          |
| ☐   | Terms of use published and linked from the landing page (C3)                                                                                     |          |
| ☐   | Grievance officer and company details on the landing page and privacy notice (C1)                                                                |          |
| ☐   | Store privacy answers reviewed and submitted (`docs/store/privacy-labels.md`): App Store App Privacy, Play Data safety, the account-deletion URL |          |

## 5. Real use, on production

| ✓   | Check                                                                                 | Evidence |
| --- | ------------------------------------------------------------------------------------- | -------- |
| ☐   | A real sign-up on the web (OTP email received from Resend)                            |          |
| ☐   | A real sign-up on Android (internal testing build)                                    |          |
| ☐   | A real sign-up on iOS (TestFlight build)                                              |          |
| ☐   | Two test accounts match and chat in real time                                         |          |
| ☐   | A push notification received on a phone                                               |          |
| ☐   | A report filed from the app and processed in the admin console (with its audit entry) |          |
| ☐   | Gateway memory per socket re-measured on Render (Phase 9 note)                        |          |
| ☐   | The test accounts are deleted from production afterwards                              |          |

## 6. Go

| ✓   | Check                                                                           | Evidence |
| --- | ------------------------------------------------------------------------------- | -------- |
| ☐   | Every line above is ticked                                                      |          |
| ☐   | The owner announces the beta to the first testers                               |          |
| ☐   | The first week: the dashboards are checked daily; ADR 0028 step-down data noted |          |
