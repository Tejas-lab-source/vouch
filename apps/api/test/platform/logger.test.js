// @ts-check
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runWithContext } from '../../src/platform/context.js';
import { createLogger } from '../../src/platform/logger.js';

function capture() {
  /** @type {any[]} */
  const lines = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination }) };
}

describe('logger', () => {
  it('redacts tokens, emails, message bodies and auth headers', () => {
    const { lines, logger } = capture();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer secret', cookie: 'vouch_refresh=secret' } },
        user: { email: 'a@b.edu', refreshToken: 'rt', name: 'ok' },
        message: { body: 'hello there' },
        email: 'top@b.edu',
      },
      'event',
    );
    const text = JSON.stringify(lines[0]);
    for (const secret of [
      'Bearer secret',
      'vouch_refresh=secret',
      'a@b.edu',
      'rt"',
      'hello there',
      'top@b.edu',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(lines[0].user.name).toBe('ok');
  });

  it('adds request id, trace id and module from the async context', () => {
    const { lines, logger } = capture();
    runWithContext({ requestId: 'req-1', traceId: 'trace-1', module: 'matching' }, () =>
      logger.info('inside'),
    );
    logger.info('outside');
    expect(lines[0]).toMatchObject({ requestId: 'req-1', traceId: 'trace-1', module: 'matching' });
    expect(lines[1].requestId).toBeUndefined();
  });
});
