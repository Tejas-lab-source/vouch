# Operations

How to run Vouch in production (Phase 15). Where things are: `docs/infrastructure.md`.
Incidents: `docs/runbooks/incident.md`. Data breach: `docs/runbooks/breach.md`. Restore:
`docs/runbooks/restore.md`.

Never paste a secret into chat, an issue, a commit or a ticket. Secrets are typed into the
host's settings (Render, GitHub, Expo, Grafana) and nowhere else.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`:

1. **CI**: the full suite, as on pull requests.
2. **Staging**:
   - the API and the backup job, deployed at that exact commit through Render's API
   - migrations run first, as Render's pre-deploy command (expand-only, ADR 0006); a failed
     migration stops the deploy and the old version keeps serving
   - web, admin and landing built for staging and uploaded to Cloudflare Pages
   - the smoke suite (`scripts/smoke.js`) and the read-only browser checks
3. **Production** waits for your approval: GitHub → Actions → the run → **Review
   deployments** → `production` → Approve. It deploys the same commit, runs the smoke suite,
   then watches for 10 minutes (`scripts/deploy-watch.js`).

To redeploy without a new commit: Actions → Deploy → **Run workflow** on `main`.

## Roll back

- **Automatic:** if the production smoke suite or the 10-minute watch fails (5xx above 2%,
  or `/ready` failing twice), the job rolls the API back to the deploy that was live before.
  The old instance drains its sockets for 25 s.
- **By hand:**
  - Render → `vouch-api` → Events → an earlier deploy → **Rollback**, or
  - `RENDER_API_KEY=… node scripts/render-deploy.js rollback --service srv-… --to dep-…`
- **Web and admin** stay on the new build: contracts are additive, so a new web app works with
  the previous API. To roll them back too: Cloudflare → Pages → the project → Deployments → an
  earlier one → **Rollback**.
- **Migrations are not rolled back.** They are expand-only, so the previous API runs on the new
  schema. Never run `migrations/run.js down` in production.
- **Rehearsal:** Actions → Deploy → Run workflow → tick "rehearse_rollback". Staging is rolled
  back, smoke-tested and deployed forward again.

## Dashboards

Grafana Cloud → Dashboards → folder **Vouch**. Pick the environment at the top (`job`).

- **System overview:**
  - traffic, the 5xx share, HTTP p95 by route, event-loop lag, CPU, memory, sheds
  - the event bus (outbox lag, queues, dead letters)
  - Redis memory, backup age, consistency violations, overdue photo reviews
- **One dashboard per module:** its use cases' rate, failures and latency, and its event
  queue.

Dashboards and alerts are code (`infra/grafana/`). After changing `build.js`:

1. Run `node infra/grafana/build.js` and commit the JSON.
2. With the Grafana values in your own shell, run `node infra/grafana/sync.js`:
   `GRAFANA_URL`, `GRAFANA_TOKEN` (a service account token with Editor), `GRAFANA_PROMETHEUS_UID`
   and `GRAFANA_CONTACT_POINT`.

A test alert: `node infra/grafana/sync.js --test-alert`; it fires within about 2 minutes.
Remove it with `--clear-test-alert`.

## Alerts

Each alert links here. All fire for production only.

<a id="vouch-api-down"></a>

### API not scraped

Grafana cannot read `/internal/metrics`.

1. Open `https://api…/health` and `/ready`.
2. If the API is down, look at Render → `vouch-api` → Logs and Events. A failed deploy shows
   there. A crash loop: roll back.
3. If the API is up, the scrape is failing: check the Metrics Endpoint job and that its token
   matches `METRICS_SCRAPE_TOKEN`.

<a id="vouch-error-rate"></a>

### API 5xx above 2%

1. Sentry → `vouch-api` → Issues, sorted by Events in the last hour.
2. Did a deploy just happen? Roll back (above).
3. `/ready` failing means a dependency: Postgres (Render → `vouch-db` → Metrics) or Redis.
4. 503s with `TEMPORARILY_UNAVAILABLE` are overload sheds: see the sheds alert.

<a id="vouch-outbox-lag"></a>

### Outbox lag above 60 s

Events are not being published, so matches, chats and notifications stall.

1. Check the API logs for `outbox relay failed`.
2. Look at Postgres load and connections. The relay needs a connection from the pool.
3. Check Redis is reachable (`/ready`): publishing enqueues to Redis.
4. A restart (Render → Manual Deploy → Restart service) re-creates the relay. No event is
   lost: unpublished rows stay in `platform.outbox` until published.

<a id="vouch-dead-letters"></a>

### Dead-letter queue not empty

A job failed every retry. Its copy is in `dlq.<queue>`.

1. Find the error: the API logs around the time, by the job name, and Sentry.
2. In the Render shell, `node scripts/dlq.js list` shows each failed job's name, id and
   reason (never its payload).
3. Fix the cause (a bad payload, an external service down), then replay:
   `node scripts/dlq.js replay --queue <queue> [--job <id>]`. Handlers and consumers are
   idempotent, so a replay is safe.
4. A dead-lettered **event** means one consumer missed it. The nightly consistency check
   reports any lasting gap.

<a id="vouch-queue-stuck"></a>

### A job has waited over 5 minutes

The workers are not taking jobs: a stalled worker, Redis trouble, or a flood.

1. On the overview, check "Oldest waiting job by queue" to see which queue.
2. Check CPU and event-loop lag; if both are high, the process is overloaded.
3. Restart the service if the queue does not move.

<a id="vouch-redis-memory"></a>

### Redis memory above 70%

Key Value runs with `noeviction`: when full, writes fail and jobs cannot be queued.

1. Look for a growing queue (completed and failed jobs are trimmed after 1 hour and 7 days).
2. Step Key Value up one plan in Render, then find the cause.

<a id="vouch-backup-age"></a>

### Backup older than 26 hours

The nightly backup did not succeed.

1. Render → `vouch-backup` → its last run's logs.
2. Common causes: the R2 token was rotated, or `pg_dump` does not match the server's major
   version (the image ships `postgresql17-client`).
3. Run it now: Render → `vouch-backup` → **Trigger Run**. Render's own daily backup is the
   second copy meanwhile.

<a id="vouch-sheds"></a>

### Overload sheds

The API refused work under overload: event-loop lag over 250 ms, heap over 85%, or more than
128 requests in flight. Each refusal is a quick 503 with `Retry-After`.

1. On the overview, check what drove it: CPU, lag, memory, or Postgres (in-flight requests
   queue for connections when the database is slow).
2. A one-off spike is fine. Repeated sheds at peak mean the plan is too small (ADR 0028). Step
   up, or split roles later.

<a id="vouch-consistency"></a>

### Consistency violations

The nightly cross-module check found a mismatch, for example data kept for a deleted user.

1. The API logs at 03:17 UTC name the check and the count.
2. `deleted_users_with_data` after a restore means erasures must be re-applied (restore
   runbook, step 8).
3. Anything else is a bug: open an incident and tell the developer.

## Restore

See `docs/runbooks/restore.md`. Run the drill every month and log it there.

## Rotate keys

| Secret                                                                                | How                                                                                                                                                                                                   | Effect                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `JWT_SIGNING_KEYS` / `JWT_ACTIVE_KID`                                                 | On your computer, copy both current values from Render (two lines, `NAME=value`), then run `pbpaste \| node scripts/gen-secrets.js rotate-jwt production`. Paste both outputs into Render and deploy. | Old access tokens keep working for 15 minutes; nobody is signed out |
| `COOKIE_SECRET`                                                                       | `gen-secrets.js`, take that one value                                                                                                                                                                 | Harmless: cookies are not signed with state that matters            |
| `METRICS_SCRAPE_TOKEN`                                                                | New value from `gen-secrets.js`; update Render, the Grafana scrape job and both GitHub environments                                                                                                   | A gap in metrics until all three match                              |
| `R2_*`, `RESEND_API_KEY`, `EXPO_ACCESS_TOKEN`, `MODERATION_*`, `TURNSTILE_SECRET_KEY` | Create the new key at the vendor, put it in Render, deploy, then delete the old key at the vendor                                                                                                     | None, if done in that order                                         |
| `RENDER_API_KEY`, `CLOUDFLARE_API_TOKEN`, `SENTRY_AUTH_TOKEN`                         | Create the new one, update both GitHub environments, delete the old one                                                                                                                               | Only deploys use them                                               |
| `EMAIL_HMAC_SECRET`                                                                   | **Never.** Every account is found by it                                                                                                                                                               | Changing it orphans every account                                   |
| `ADMIN_TOTP_KEY`                                                                      | Only with a re-enrolment of every staff member                                                                                                                                                        | Staff TOTP stops working                                            |

After a suspected leak, rotate first, then follow `docs/runbooks/breach.md`.

## Add a campus

Run these in the Render shell (`vouch-api` → Shell), or locally with the staging
`DATABASE_URL`.

1. Add the college:
   `node scripts/college-add.js --name "<College>" --city <City> --domains <student domain>[,<more>] --invite-only`
   - `--cluster <name>` puts colleges in one cluster: students see each other across them.
     The default cluster is the city.
   - The domain must be exactly what students' emails end with. Subdomains are separate
     domains (`alumni.<domain>` is refused).
2. Create invite codes:
   `node scripts/invite-create.js --college <domain or id> --count 50 [--uses 1] [--expires-days 30] [--label "batch 1"]`
   - The codes are printed once. Only hashes are stored. Hand them out, one per tester.
   - `--uses 0` makes one code for a whole group (unlimited uses).
3. **Open the campus later:** remove the college from the `beta.invite_only` flag's campus
   rule (admin console → Flags, or SQL on `platform.feature_flags`). It takes effect within
   30 s.

## Staff accounts

In the Render shell:

    node scripts/admin-create.js --email <email> --name "<Name>" --role moderator

The password (set `ADMIN_CREATE_PASSWORD` first, or let it print one) and the TOTP QR link are
shown once, to the person creating the account. Scan the link with an authenticator app.
Staff sign in only from `ADMIN_IP_ALLOWLIST`.

## Step the API down (ADR 0028)

All of these must hold over a representative week of peak traffic (the overview dashboard):

- API CPU under 40% of one core at peak
- event-loop lag p99 under 100 ms
- HTTP p95 under 150 ms
- no sheds
- memory (RSS) under 400 MB

Then, if you decide to:

1. Re-check at the beta peak with `LOAD_API_CPUS=0.5 load/run.sh 300 0.1`.
2. Render → `vouch-api` → Settings → Instance Type → Starter.
3. Watch the overview for a week. Step back up if any line is crossed.
