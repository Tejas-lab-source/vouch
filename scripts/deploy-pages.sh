#!/usr/bin/env bash
# Builds apps/web and apps/admin for one environment and uploads them to Cloudflare Pages
# (Phase 15). Run by .github/workflows/deploy.yml with the GitHub environment's variables:
#   DEPLOY_ENV, API_URL, CDN_URL, UPLOAD_ORIGIN, SENTRY_INGEST, SENTRY_ORG,
#   SENTRY_DSN_WEB, SENTRY_DSN_ADMIN, TURNSTILE_SITE_KEY, GRIEVANCE_EMAIL,
#   PAGES_PROJECT_WEB, PAGES_PROJECT_ADMIN, CLOUDFLARE_ACCOUNT_ID, RELEASE (the commit)
# and secrets CLOUDFLARE_API_TOKEN and SENTRY_AUTH_TOKEN (optional: no source-map upload).
set -euo pipefail

: "${DEPLOY_ENV:?}" "${API_URL:?}" "${RELEASE:?}"
: "${PAGES_PROJECT_WEB:?}" "${PAGES_PROJECT_ADMIN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${CLOUDFLARE_API_TOKEN:?}"

build_app() {
  local app=$1 dsn=$2
  echo "== build ${app} (${DEPLOY_ENV}, ${RELEASE:0:12})"
  VITE_API_BASE="$API_URL" \
    VITE_DEPLOY_ENV="$DEPLOY_ENV" \
    VITE_RELEASE="$RELEASE" \
    VITE_SENTRY_DSN="$dsn" \
    VITE_TURNSTILE_SITE_KEY="${TURNSTILE_SITE_KEY:-}" \
    VITE_GRIEVANCE_EMAIL="${GRIEVANCE_EMAIL:-}" \
    SENTRY_PROJECT_WEB=vouch-web SENTRY_PROJECT_ADMIN=vouch-admin \
    pnpm --filter "@vouch/${app}" build
  if [ -n "$(find "apps/${app}/dist" -name '*.map' -print -quit)" ]; then
    if [ -n "${SENTRY_AUTH_TOKEN:-}" ]; then
      echo "source maps were not removed after upload" >&2
      exit 1
    fi
    # No Sentry token: never publish source maps.
    find "apps/${app}/dist" -name '*.map' -delete
  fi
  node scripts/pages-headers.js "apps/${app}/dist" --app "$app" --api "$API_URL" \
    ${CDN_URL:+--cdn "$CDN_URL"} ${UPLOAD_ORIGIN:+--upload "$UPLOAD_ORIGIN"} \
    ${SENTRY_INGEST:+--sentry "$SENTRY_INGEST"}
}

deploy_app() {
  local app=$1 project=$2
  echo "== deploy ${app} to Pages project ${project}"
  pnpm exec wrangler pages deploy "apps/${app}/dist" \
    --project-name "$project" \
    --branch main \
    --commit-hash "$RELEASE" \
    --commit-dirty=false
}

build_app web "${SENTRY_DSN_WEB:-}"
pnpm --filter @vouch/web size
build_app admin "${SENTRY_DSN_ADMIN:-}"
deploy_app web "$PAGES_PROJECT_WEB"
deploy_app admin "$PAGES_PROJECT_ADMIN"
