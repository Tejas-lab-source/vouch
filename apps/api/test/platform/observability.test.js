// @ts-check
import { describe, expect, it } from 'vitest';
import { startErrorReporting, startTracing } from '../../src/platform/observability.js';

describe('observability', () => {
  it('tracing is a no-op without an OTLP endpoint', async () => {
    const stop = await startTracing({ serviceName: 'vouch-api' });
    await expect(stop()).resolves.toBeUndefined();
  });

  it('starts and shuts down the OpenTelemetry SDK when an endpoint is set', async () => {
    const stop = await startTracing({
      endpoint: 'http://127.0.0.1:1/',
      serviceName: 'vouch-api-test',
    });
    await expect(stop()).resolves.toBeUndefined();
  }, 30_000);

  it('error reporting is a no-op without a DSN', async () => {
    const errors = await startErrorReporting({ environment: 'local' });
    errors.report(new Error('x'));
    await expect(errors.flush()).resolves.toBeUndefined();
  });

  it('initialises Sentry with a DSN and reports without throwing', async () => {
    const errors = await startErrorReporting({
      dsn: 'https://public@127.0.0.1:1/1',
      environment: 'test',
    });
    errors.report(new Error('reported'));
    await expect(errors.flush()).resolves.toBeUndefined();
  }, 30_000);
});
