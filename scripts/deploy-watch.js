// @ts-check
/**
 * Watches a fresh production deploy (Phase 15): reads the API's request counters from
 * `/internal/metrics` (METRICS_SCRAPE_TOKEN), checks /ready every minute, and after the window
 * fails when the 5xx share of requests is above the threshold. The deploy workflow rolls back
 * when this fails.
 *
 *   node scripts/deploy-watch.js --api https://api.example.app [--minutes 10] [--max-error 0.02]
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Operational routes are not user traffic. */
const IGNORED_ROUTES = new Set(['/health', '/ready', '/internal/metrics']);
/** Below this many requests in the window, the share is not meaningful: only /ready decides. */
export const MIN_REQUESTS = 50;

/**
 * Totals of `http_request_duration_seconds_count` from Prometheus text, user routes only.
 * @param {string} text
 * @returns {{ total: number, errors: number }}
 */
export function requestTotals(text) {
  let total = 0;
  let errors = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('http_request_duration_seconds_count{')) continue;
    const route = /route="([^"]*)"/.exec(line)?.[1] ?? '';
    const status = Number(/status_code="(\d+)"/.exec(line)?.[1] ?? 0);
    const value = Number(line.slice(line.lastIndexOf(' ') + 1));
    if (IGNORED_ROUTES.has(route) || !Number.isFinite(value)) continue;
    total += value;
    if (status >= 500) errors += value;
  }
  return { total, errors };
}

/**
 * The verdict for one window. A restart resets the counters; then the end sample alone counts.
 * @param {{ total: number, errors: number }} start
 * @param {{ total: number, errors: number }} end
 * @param {number} maxError
 */
export function verdict(start, end, maxError) {
  const reset = end.total < start.total;
  const total = reset ? end.total : end.total - start.total;
  const errors = reset ? end.errors : end.errors - start.errors;
  const share = total > 0 ? errors / total : 0;
  const ok = total < MIN_REQUESTS || share <= maxError;
  return { ok, total, errors, share };
}

/**
 * @param {{ api: string, token: string, minutes: number, maxError: number, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>, log?: (line: string) => void }} options
 */
export async function watchDeploy({
  api,
  token,
  minutes,
  maxError,
  fetch: fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
}) {
  const scrape = async () => {
    const response = await fetchImpl(`${api}/internal/metrics`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`/internal/metrics: ${response.status}`);
    return requestTotals(await response.text());
  };
  const start = await scrape();
  let notReady = 0;
  for (let minute = 1; minute <= minutes; minute += 1) {
    await sleep(60_000);
    const ready = await fetchImpl(`${api}/ready`).then(
      (r) => r.status === 200,
      () => false,
    );
    notReady = ready ? 0 : notReady + 1;
    log(`minute ${minute}: ${ready ? 'ready' : 'NOT READY'}`);
    // Two failed checks in a row: no need to wait out the window.
    if (notReady >= 2) return { ok: false, reason: 'not ready for 2 minutes' };
  }
  const result = verdict(start, await scrape(), maxError);
  log(
    `${result.errors}/${result.total} requests failed (${(result.share * 100).toFixed(2)}%), ` +
      `limit ${(maxError * 100).toFixed(1)}%`,
  );
  return { ...result, reason: result.ok ? 'healthy' : '5xx share above the limit' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      api: { type: 'string' },
      minutes: { type: 'string', default: '10' },
      'max-error': { type: 'string', default: '0.02' },
    },
  });
  const token = process.env.METRICS_SCRAPE_TOKEN;
  const run = async () => {
    if (!values.api || !token) throw new Error('--api and METRICS_SCRAPE_TOKEN are required');
    const result = await watchDeploy({
      api: values.api.replace(/\/+$/, ''),
      token,
      minutes: Number(values.minutes),
      maxError: Number(values['max-error']),
      log: (line) => process.stdout.write(`${line}\n`),
    });
    if (!result.ok) throw new Error(result.reason);
  };
  run().catch((error) => {
    process.stderr.write(`deploy-watch: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
