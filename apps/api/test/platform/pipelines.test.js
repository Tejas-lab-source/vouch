// @ts-check
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';
import { createPipelines } from '../../src/platform/pipelines.js';

const logger = pino({ level: 'silent' });
const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('pipelines', () => {
  it('runs steps in order, each receiving the previous output', async () => {
    const p = createPipelines({ logger });
    p.define('demo.chain');
    p.contribute('demo.chain', {
      id: 'b.double',
      order: 20,
      run: (/** @type {number} */ x) => x * 2,
    });
    p.contribute('demo.chain', {
      id: 'a.addOne',
      order: 10,
      run: (/** @type {number} */ x) => x + 1,
    });
    expect(p.steps('demo.chain')).toEqual(['a.addOne', 'b.double']);
    expect(await p.run('demo.chain', 3)).toBe(8);
  });

  it('skips a step that throws or times out, and keeps going', async () => {
    const p = createPipelines({ logger });
    p.define('demo.lenient', { stepTimeoutMs: 20 });
    p.contribute('demo.lenient', {
      id: 'boom',
      order: 1,
      run: () => {
        throw new Error('boom');
      },
    });
    p.contribute('demo.lenient', {
      id: 'slow',
      order: 2,
      run: async () => {
        await sleep(100);
        return 99;
      },
    });
    p.contribute('demo.lenient', { id: 'inc', order: 3, run: (/** @type {number} */ x) => x + 1 });
    expect(await p.run('demo.lenient', 1)).toBe(2);
  });

  it('fails closed for safety chains', async () => {
    const p = createPipelines({ logger });
    p.define('safety.demo', { failClosed: true, stepTimeoutMs: 20 });
    p.contribute('safety.demo', {
      id: 'slow',
      order: 1,
      run: async () => {
        await sleep(100);
      },
    });
    await expect(p.run('safety.demo', {})).rejects.toBeInstanceOf(AppError);
  });

  it('collects every step output for the same input (scorers)', async () => {
    const p = createPipelines({ logger });
    p.define('demo.scorers');
    p.contribute('demo.scorers', { id: 'one', order: 1, run: () => ({ score: 0.5 }) });
    p.contribute('demo.scorers', {
      id: 'broken',
      order: 2,
      run: () => {
        throw new Error('x');
      },
    });
    p.contribute('demo.scorers', { id: 'two', order: 3, run: () => ({ score: 1 }) });
    expect(await p.collect('demo.scorers', {})).toEqual([
      { id: 'one', value: { score: 0.5 } },
      { id: 'two', value: { score: 1 } },
    ]);
  });

  it('refuses unknown chains, duplicate chains and duplicate steps', () => {
    const p = createPipelines({ logger });
    p.define('demo.x');
    expect(() => p.define('demo.x')).toThrow(/already defined/);
    expect(() => p.contribute('demo.missing', { id: 'a', order: 1, run: () => 1 })).toThrow(
      /unknown pipeline/,
    );
    p.contribute('demo.x', { id: 'a', order: 1, run: () => 1 });
    expect(() => p.contribute('demo.x', { id: 'a', order: 2, run: () => 1 })).toThrow(
      /duplicate step/,
    );
  });
});
