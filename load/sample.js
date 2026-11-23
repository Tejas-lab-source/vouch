// @ts-check
/**
 * Samples the load stack every 5 s while k6 runs (load/README.md) and appends one JSON line
 * per sample to load/out/samples.jsonl:
 * - CPU and memory of each container (`docker stats`)
 * - the API's event-loop lag p99 and RSS (its /metrics)
 * - outbox lag: the age of the oldest unpublished event, and the backlog
 * - queue ages: the age of the oldest waiting job in each BullMQ queue
 *
 * Usage: node load/sample.js [seconds]
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('./out/samples.jsonl', import.meta.url));
const METRICS = 'http://127.0.0.1:59464/metrics';
const run = (/** @type {string[]} */ args) =>
  execFileSync('docker', args, { encoding: 'utf8', timeout: 20_000 }).trim();
const psql = (/** @type {string} */ query) =>
  run(['exec', 'vouch-load-postgres-1', 'psql', '-U', 'vouch', '-d', 'vouch', '-At', '-c', query]);
const redis = (/** @type {string[]} */ args) =>
  run(['exec', 'vouch-load-redis-1', 'redis-cli', ...args]);

async function sample() {
  /** @type {Record<string, unknown>} */
  const s = { at: new Date().toISOString() };
  for (const line of run([
    'stats',
    '--no-stream',
    '--format',
    '{{.Name}} {{.CPUPerc}} {{.MemUsage}}',
  ]).split('\n')) {
    const [name, cpu, mem] = line.split(' ');
    if (name?.startsWith('vouch-load-')) {
      s[`${name.replace('vouch-load-', '').replace(/-1$/, '')}Cpu`] = Number.parseFloat(cpu ?? '');
      s[`${name.replace('vouch-load-', '').replace(/-1$/, '')}Mem`] = mem;
    }
  }
  try {
    const text = await (await fetch(METRICS)).text();
    /** @type {Map<string, number>} */
    const values = new Map();
    for (const line of text.split('\n')) {
      const [name, value] = line.split(' ');
      if (name && value && !name.startsWith('#')) values.set(name, Number(value));
    }
    s.eventLoopLagP99Ms = Math.round((values.get('nodejs_eventloop_lag_p99_seconds') ?? 0) * 1000);
    s.apiRssMb = Math.round((values.get('process_resident_memory_bytes') ?? 0) / 1048576);
  } catch {
    s.metrics = 'unavailable';
  }
  const [age, backlog] = psql(
    `SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0)::numeric(10,2), count(*)
       FROM platform.outbox WHERE published_at IS NULL`,
  ).split('|');
  s.outboxLagS = Number(age);
  s.outboxBacklog = Number(backlog);
  /** @type {Map<string, number>} */
  const queues = new Map();
  for (const key of redis(['--scan', '--pattern', 'bull:*:wait']).split('\n').filter(Boolean)) {
    const queue = key.split(':')[1] ?? '';
    const oldest = redis(['LINDEX', key, '-1']);
    const ts = oldest ? Number(redis(['HGET', `bull:${queue}:${oldest}`, 'timestamp'])) : 0;
    queues.set(queue, ts ? Math.round((Date.now() - ts) / 100) / 10 : 0);
  }
  s.queueOldestWaitS = Object.fromEntries(queues);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path under load/out
  appendFileSync(OUT, `${JSON.stringify(s)}\n`);
}

// eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path under load/out
mkdirSync(fileURLToPath(new URL('./out/', import.meta.url)), { recursive: true });
const until = Date.now() + Number(process.argv[2] ?? 420) * 1000;
while (Date.now() < until) {
  const started = Date.now();
  await sample().catch((error) =>
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path under load/out
    appendFileSync(OUT, `${JSON.stringify({ error: String(error) })}\n`),
  );
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 5000 - (Date.now() - started))));
}
