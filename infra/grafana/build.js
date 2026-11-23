// @ts-check
/**
 * Grafana dashboards and alert rules as code (Phase 15). `node infra/grafana/build.js` writes
 * the JSON next to this file (committed, so changes are reviewed); `sync.js` uploads them to
 * Grafana Cloud. Every query uses only metrics the API exports (checked by a test).
 *
 * Grafana Cloud scrapes `/internal/metrics` with two Metrics Endpoint jobs named
 * `vouch-staging` and `vouch-production`; that name is the `job` label used here.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const MODULES = /** @type {const} */ ([
  'identity',
  'profiles',
  'media',
  'safety',
  'discovery',
  'matching',
  'chat',
  'notifications',
  'admin',
]);
export const PRODUCTION_JOB = 'vouch-production';
const DS = { type: 'prometheus', uid: '${datasource}' };
/** User traffic only: health checks and the scrape itself are excluded. */
const USER_ROUTES = 'route!~"/health|/ready|/internal/metrics"';
const J = 'job=~"$job"';

/**
 * @typedef {{ title: string, exprs: [string, string][], unit?: string, type?: 'timeseries' | 'stat', w?: number, thresholds?: number[] }} PanelSpec
 */

/** @param {PanelSpec[]} specs */
function layout(specs) {
  let x = 0;
  let y = 0;
  return specs.map((spec, index) => {
    const w = spec.w ?? 12;
    const h = spec.type === 'stat' ? 5 : 8;
    if (x + w > 24) {
      x = 0;
      y += 8;
    }
    const panel = {
      id: index + 1,
      type: spec.type ?? 'timeseries',
      title: spec.title,
      datasource: DS,
      gridPos: { x, y, w, h },
      targets: spec.exprs.map(([expr, legendFormat], i) => ({
        refId: String.fromCharCode(65 + i),
        datasource: DS,
        expr,
        legendFormat,
      })),
      fieldConfig: {
        defaults: {
          unit: spec.unit ?? 'short',
          ...(spec.thresholds
            ? {
                thresholds: {
                  mode: 'absolute',
                  steps: [
                    { color: 'green', value: null },
                    ...spec.thresholds.map((value, i) => ({
                      color: i === 0 ? 'orange' : 'red',
                      value,
                    })),
                  ],
                },
              }
            : {}),
        },
        overrides: [],
      },
      options: {},
    };
    x += w;
    return panel;
  });
}

/** @param {string} uid @param {string} title @param {PanelSpec[]} specs */
function dashboard(uid, title, specs) {
  return {
    uid,
    title,
    tags: ['vouch'],
    timezone: 'browser',
    schemaVersion: 39,
    refresh: '1m',
    time: { from: 'now-6h', to: 'now' },
    templating: {
      list: [
        { name: 'datasource', label: 'Data source', type: 'datasource', query: 'prometheus' },
        {
          name: 'job',
          label: 'Environment',
          type: 'query',
          datasource: DS,
          query: 'label_values(process_cpu_user_seconds_total, job)',
          current: { text: PRODUCTION_JOB, value: PRODUCTION_JOB },
          refresh: 1,
        },
      ],
    },
    panels: layout(specs),
  };
}

/** The system overview: traffic, errors, latency, saturation, the event bus and backups. */
export function overviewDashboard() {
  return dashboard('vouch-overview', 'Vouch — system overview', [
    {
      title: 'Requests per second by status',
      exprs: [
        [
          `sum by (status_code) (rate(http_request_duration_seconds_count{${J},${USER_ROUTES}}[5m]))`,
          '{{status_code}}',
        ],
      ],
      unit: 'reqps',
    },
    {
      title: '5xx share of requests (alert above 2%)',
      exprs: [
        [
          `sum(rate(http_requests_errors_total{${J},${USER_ROUTES}}[5m])) / clamp_min(sum(rate(http_request_duration_seconds_count{${J},${USER_ROUTES}}[5m])), 1e-9)`,
          '5xx share',
        ],
      ],
      unit: 'percentunit',
      thresholds: [0.01, 0.02],
    },
    {
      title: 'HTTP p95 latency by route (SLO 300 ms; step-down needs < 150 ms)',
      exprs: [
        [
          `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{${J},${USER_ROUTES}}[5m])))`,
          '{{route}}',
        ],
      ],
      unit: 's',
    },
    {
      title: 'Event-loop lag p99 (step-down needs < 100 ms)',
      exprs: [[`max(nodejs_eventloop_lag_p99_seconds{${J}})`, 'p99']],
      unit: 's',
      thresholds: [0.1, 0.25],
    },
    {
      title: 'CPU (share of one core; step-down needs < 40% at peak)',
      exprs: [[`sum(rate(process_cpu_seconds_total{${J}}[5m]))`, 'cpu']],
      unit: 'percentunit',
      thresholds: [0.4, 0.8],
    },
    {
      title: 'Memory (step-down needs RSS < 400 MB)',
      exprs: [
        [`max(process_resident_memory_bytes{${J}})`, 'rss'],
        [`max(nodejs_heap_size_used_bytes{${J}})`, 'heap used'],
      ],
      unit: 'bytes',
    },
    {
      title: 'Overload sheds (503 and refused sockets)',
      exprs: [
        [`sum by (kind, reason) (increase(vouch_shed_total{${J}}[5m]))`, '{{kind}} {{reason}}'],
      ],
    },
    {
      title: 'Outbox: lag and backlog (alert above 60 s)',
      exprs: [
        [`max(vouch_outbox_lag_seconds{${J}})`, 'lag (s)'],
        [`max(vouch_outbox_unpublished{${J}})`, 'unpublished'],
      ],
    },
    {
      title: 'Oldest waiting job by queue',
      exprs: [[`max by (queue) (vouch_queue_oldest_waiting_seconds{${J}})`, '{{queue}}']],
      unit: 's',
    },
    {
      title: 'Dead-letter jobs by queue (alert above 0)',
      exprs: [[`max by (queue) (vouch_dead_letter_jobs{${J}})`, '{{queue}}']],
    },
    {
      title: 'Redis memory (alert above 70%)',
      exprs: [[`max(vouch_redis_memory_ratio{${J}})`, 'used / max']],
      unit: 'percentunit',
      type: 'stat',
      w: 6,
      thresholds: [0.6, 0.7],
    },
    {
      title: 'Newest backup age (alert above 26 h)',
      exprs: [[`max(vouch_backup_age_seconds{${J}})`, 'age']],
      unit: 's',
      type: 'stat',
      w: 6,
      thresholds: [86400, 93600],
    },
    {
      title: 'Consistency violations (nightly check)',
      exprs: [[`sum(vouch_consistency_violations{${J}})`, 'violations']],
      type: 'stat',
      w: 6,
      thresholds: [1],
    },
    {
      title: 'Photos in review over 48 h',
      exprs: [[`max(vouch_photo_reviews_overdue{${J}})`, 'overdue']],
      type: 'stat',
      w: 6,
      thresholds: [1, 20],
    },
  ]);
}

/** One dashboard per module: its use cases' rate, errors and latency. @param {string} module */
export function moduleDashboard(module) {
  const U = `usecase=~"${module}\\\\..*"`;
  return dashboard(`vouch-${module}`, `Vouch — ${module}`, [
    {
      title: 'Use cases per second',
      exprs: [
        [`sum by (usecase) (rate(usecase_duration_seconds_count{${J},${U}}[5m]))`, '{{usecase}}'],
      ],
      unit: 'ops',
    },
    {
      title: 'Failed use cases per second',
      exprs: [
        [
          `sum by (usecase) (rate(usecase_duration_seconds_count{${J},${U},outcome="error"}[5m]))`,
          '{{usecase}}',
        ],
      ],
      unit: 'ops',
    },
    {
      title: 'Use-case p95 latency',
      exprs: [
        [
          `histogram_quantile(0.95, sum by (le, usecase) (rate(usecase_duration_seconds_bucket{${J},${U}}[5m])))`,
          '{{usecase}}',
        ],
      ],
      unit: 's',
    },
    {
      title: 'Use-case p50 latency',
      exprs: [
        [
          `histogram_quantile(0.5, sum by (le, usecase) (rate(usecase_duration_seconds_bucket{${J},${U}}[5m])))`,
          '{{usecase}}',
        ],
      ],
      unit: 's',
    },
    {
      title: `Events waiting for ${module} (evt.${module} queue)`,
      exprs: [
        [`max(vouch_queue_oldest_waiting_seconds{${J},queue="evt.${module}"})`, 'oldest waiting'],
      ],
      unit: 's',
    },
    {
      title: `Dead-lettered ${module} events`,
      exprs: [[`max(vouch_dead_letter_jobs{${J},queue="evt.${module}"})`, 'dead letters']],
    },
  ]);
}

/**
 * @typedef {{ uid: string, title: string, expr: string, op: 'gt' | 'lt', threshold: number, for: string, severity: 'critical' | 'warning', summary: string, noData?: 'OK' | 'Alerting' | 'NoData' }} AlertSpec
 */

const P = `job="${PRODUCTION_JOB}"`;

/** @type {AlertSpec[]} */
export const ALERTS = [
  {
    uid: 'vouch-api-down',
    title: 'API not scraped (down or unreachable)',
    expr: `max(up{${P}})`,
    op: 'lt',
    threshold: 1,
    for: '3m',
    severity: 'critical',
    summary: 'Grafana cannot scrape the production API for 3 minutes.',
    noData: 'Alerting',
  },
  {
    uid: 'vouch-error-rate',
    title: 'API 5xx above 2%',
    expr: `sum(rate(http_requests_errors_total{${P},${USER_ROUTES}}[5m])) / clamp_min(sum(rate(http_request_duration_seconds_count{${P},${USER_ROUTES}}[5m])), 1e-9)`,
    op: 'gt',
    threshold: 0.02,
    for: '5m',
    severity: 'critical',
    summary: 'More than 2% of API requests failed with 5xx for 5 minutes.',
  },
  {
    uid: 'vouch-outbox-lag',
    title: 'Outbox lag above 60 s',
    expr: `max(vouch_outbox_lag_seconds{${P}})`,
    op: 'gt',
    threshold: 60,
    for: '2m',
    severity: 'critical',
    summary: 'Events are not being published: the oldest is over 60 s old.',
  },
  {
    uid: 'vouch-dead-letters',
    title: 'Dead-letter queue not empty',
    expr: `sum(vouch_dead_letter_jobs{${P}})`,
    op: 'gt',
    threshold: 0,
    for: '5m',
    severity: 'warning',
    summary: 'A job failed every retry and waits in a dlq.* queue.',
  },
  {
    uid: 'vouch-queue-stuck',
    title: 'A job has waited over 5 minutes',
    expr: `max(vouch_queue_oldest_waiting_seconds{${P}})`,
    op: 'gt',
    threshold: 300,
    for: '5m',
    severity: 'warning',
    summary: 'A queue is not being worked (workers stalled or overloaded).',
  },
  {
    uid: 'vouch-redis-memory',
    title: 'Redis memory above 70%',
    expr: `max(vouch_redis_memory_ratio{${P}})`,
    op: 'gt',
    threshold: 0.7,
    for: '10m',
    severity: 'warning',
    summary: 'Redis (noeviction) is filling up: writes fail when it is full.',
  },
  {
    uid: 'vouch-backup-age',
    title: 'Backup older than 26 hours',
    expr: `max(vouch_backup_age_seconds{${P}})`,
    op: 'gt',
    threshold: 26 * 3600,
    for: '30m',
    severity: 'critical',
    summary: 'The nightly backup to R2 has not succeeded for over 26 hours.',
    noData: 'Alerting',
  },
  {
    uid: 'vouch-sheds',
    title: 'Overload sheds',
    expr: `sum(increase(vouch_shed_total{${P}}[5m]))`,
    op: 'gt',
    threshold: 0,
    for: '0s',
    severity: 'warning',
    summary: 'The API refused requests or sockets under overload (503).',
  },
  {
    uid: 'vouch-consistency',
    title: 'Consistency violations',
    expr: `sum(vouch_consistency_violations{${P}})`,
    op: 'gt',
    threshold: 0,
    for: '0s',
    severity: 'warning',
    summary: 'The nightly cross-module check found violations.',
  },
];

/**
 * Grafana's provisioning rule group (`PUT /api/v1/provisioning/folder/{folder}/rule-groups/{group}`).
 * @param {{ datasourceUid: string, folderUid: string, contactPoint: string, alerts?: AlertSpec[], group?: string }} options
 */
export function alertRuleGroup({
  datasourceUid,
  folderUid,
  contactPoint,
  alerts = ALERTS,
  group = 'vouch-production',
}) {
  return {
    title: group,
    folderUid,
    interval: 60,
    rules: alerts.map((alert) => ({
      uid: alert.uid,
      title: alert.title,
      ruleGroup: group,
      folderUID: folderUid,
      condition: 'C',
      for: alert.for,
      noDataState: alert.noData ?? 'OK',
      execErrState: 'Error',
      labels: { severity: alert.severity, service: 'vouch' },
      annotations: {
        summary: alert.summary,
        runbook_url: `https://github.com/Tejas-lab-source/vouch/blob/main/docs/OPERATIONS.md#${alert.uid}`,
      },
      notification_settings: { receiver: contactPoint },
      data: [
        {
          refId: 'A',
          datasourceUid,
          relativeTimeRange: { from: 600, to: 0 },
          model: { refId: 'A', expr: alert.expr, instant: true, range: false },
        },
        {
          refId: 'C',
          datasourceUid: '__expr__',
          model: {
            refId: 'C',
            type: 'threshold',
            expression: 'A',
            conditions: [{ evaluator: { type: alert.op, params: [alert.threshold] } }],
          },
        },
      ],
    })),
  };
}

/** Every dashboard, by file name. */
export function allDashboards() {
  return new Map([
    ['overview.json', overviewDashboard()],
    ...MODULES.map(
      (m) =>
        /** @type {[string, ReturnType<typeof dashboard>]} */ ([`${m}.json`, moduleDashboard(m)]),
    ),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('./dashboards/', import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- this folder
  await mkdir(dir, { recursive: true });
  for (const [name, model] of allDashboards()) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed names, this folder
    await writeFile(new URL(name, dir), `${JSON.stringify(model, null, 2)}\n`);
  }
  // The rule group with placeholders; sync.js fills in the real data source and contact point.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file here
  await writeFile(
    new URL('./alerts.json', import.meta.url),
    `${JSON.stringify(alertRuleGroup({ datasourceUid: '${PROMETHEUS_UID}', folderUid: 'vouch', contactPoint: '${CONTACT_POINT}' }), null, 2)}\n`,
  );
  process.stdout.write('wrote infra/grafana/dashboards/*.json and alerts.json\n');
}
