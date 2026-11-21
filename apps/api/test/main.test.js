// @ts-check
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const WAIT_TIMEOUT_MS = 8_000;

/**
 * Spawns `src/main.js` with the given environment.
 * @param {Record<string, string>} env
 */
function startMain(env) {
  const child = spawn(process.execPath, [MAIN], {
    env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info', HOST: '127.0.0.1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));

  /**
   * Resolves once the combined output matches the pattern.
   * @param {RegExp} pattern
   * @returns {Promise<void>}
   */
  const waitFor = (pattern) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${pattern}`)),
        WAIT_TIMEOUT_MS,
      );
      const check = () => {
        if (pattern.test(output)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', check);
      child.stderr.on('data', check);
      check();
    });

  /** @type {Promise<number | null>} */
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));

  return { child, waitFor, exited, output: () => output };
}

describe('main.js process lifecycle', () => {
  it('listens on PORT and serves /health', async () => {
    const proc = startMain({ PORT: '0' });
    try {
      await proc.waitFor(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
      const url = /Server listening at (http:\/\/127\.0\.0\.1:\d+)/.exec(proc.output())?.[1];
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(WAIT_TIMEOUT_MS),
      });
      expect(await response.json()).toEqual({ status: 'ok' });
    } finally {
      proc.child.kill('SIGTERM');
      await proc.exited;
    }
  });

  it('shuts down gracefully on SIGTERM with exit code 0', async () => {
    const proc = startMain({ PORT: '0' });
    await proc.waitFor(/Server listening at/);

    proc.child.kill('SIGTERM');

    expect(await proc.exited).toBe(0);
    expect(proc.output()).toMatch(/shutting down/);
    expect(proc.output()).toMatch(/shutdown complete/);
  });

  it('refuses to boot with an invalid PORT', async () => {
    const proc = startMain({ PORT: 'not-a-port' });

    expect(await proc.exited).toBe(1);
    expect(proc.output()).toMatch(/PORT must be an integer/);
  });
});
