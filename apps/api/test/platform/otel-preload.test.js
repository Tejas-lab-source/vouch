// @ts-check
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PRELOAD = fileURLToPath(new URL('../../src/otel-preload.js', import.meta.url));
const CHECK = `
  const { trace } = await import('@opentelemetry/api');
  const provider = trace.getTracerProvider();
  const real = provider.getDelegate ? provider.getDelegate().constructor.name : provider.constructor.name;
  process.stdout.write(JSON.stringify({ preloaded: Boolean(globalThis.__vouchOtelPreloaded), provider: real }));
  process.exit(0);
`;

/** @param {Record<string, string>} env */
const run = (env) =>
  JSON.parse(
    execFileSync(process.execPath, ['--import', PRELOAD, '--input-type=module', '-e', CHECK], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      timeout: 30_000,
    }),
  );

describe('OpenTelemetry preload (Phase 15)', () => {
  it('starts the SDK before the app when an endpoint is set', () => {
    const out = run({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:9' });
    expect(out.preloaded).toBe(true);
    expect(out.provider).not.toBe('NoopTracerProvider');
  });

  it('does nothing without an endpoint', () => {
    expect(run({})).toEqual({ preloaded: false, provider: 'NoopTracerProvider' });
  });
});
