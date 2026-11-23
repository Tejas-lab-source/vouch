// @ts-check
import { AppError } from './errors.js';

export const DEFAULT_STEP_TIMEOUT_MS = 50;

/**
 * @typedef {object} PipelineStep
 * @property {string} id  Unique within the chain, for logs, for example `safety.excludeBlocked`.
 * @property {number} order  Steps run in ascending order.
 * @property {(input: any) => Promise<any> | any} run
 * @property {number} [timeoutMs]  Defaults to the chain's step timeout.
 */

/**
 * @typedef {object} ChainOptions
 * @property {boolean} [failClosed]  A failing or slow step fails the whole chain (safety).
 * @property {number} [stepTimeoutMs]
 */

/**
 * Rejects when `promise` does not settle within `ms`.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`step timed out after ${ms} ms`)), ms);
  });
  return /** @type {Promise<T>} */ (Promise.race([promise, timeout])).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Named, ordered chains that other modules extend with steps (extension point 7).
 * - `run(name, input)`: each step receives the previous step's output (filters, transforms).
 * - `collect(name, input)`: every step receives the same input; returns every output (scorers).
 * A step that throws or times out is skipped and logged, unless the chain fails closed.
 * @param {{ logger: import('pino').Logger }} deps
 */
export function createPipelines({ logger }) {
  /** @type {Map<string, { options: Required<ChainOptions>, steps: PipelineStep[] }>} */
  const chains = new Map();

  /** @param {string} name */
  const chainOf = (name) => {
    const chain = chains.get(name);
    if (!chain) throw new Error(`unknown pipeline: ${name}`);
    return chain;
  };

  /**
   * Runs one step with its timeout; returns `{ ok, value }`.
   * @param {string} name
   * @param {Required<ChainOptions>} options
   * @param {PipelineStep} step
   * @param {unknown} input
   */
  const runStep = async (name, options, step, input) => {
    try {
      const result = step.run(input);
      // A synchronous step cannot be timed out (it holds the event loop until it returns), so
      // only a promise gets the timer and the race. The deck worker scores hundreds of
      // candidates per build; a timer per step was most of its allocations (Phase 14 profile).
      const value =
        result && typeof (/** @type {any} */ (result).then) === 'function'
          ? await withTimeout(
              /** @type {Promise<unknown>} */ (result),
              step.timeoutMs ?? options.stepTimeoutMs,
            )
          : result;
      return { ok: true, value };
    } catch (err) {
      if (options.failClosed) {
        logger.error({ pipeline: name, step: step.id, err }, 'pipeline step failed (fail closed)');
        throw new AppError('INTERNAL', { message: `pipeline ${name} failed closed`, cause: err });
      }
      logger.warn({ pipeline: name, step: step.id, err }, 'pipeline step skipped');
      return { ok: false, value: undefined };
    }
  };

  return {
    /**
     * Declares a chain. Only the owning module calls this.
     * @param {string} name
     * @param {ChainOptions} [options]
     */
    define(name, options = {}) {
      if (chains.has(name)) throw new Error(`pipeline already defined: ${name}`);
      chains.set(name, {
        options: {
          failClosed: options.failClosed ?? false,
          stepTimeoutMs: options.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
        },
        steps: [],
      });
    },

    /**
     * Adds a step to a chain owned by another module.
     * @param {string} name
     * @param {PipelineStep} step
     */
    contribute(name, step) {
      const chain = chainOf(name);
      if (chain.steps.some((s) => s.id === step.id))
        throw new Error(`duplicate step ${step.id} in ${name}`);
      chain.steps.push(step);
      chain.steps.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    },

    /**
     * @param {string} name
     * @param {unknown} input
     */
    async run(name, input) {
      const { options, steps } = chainOf(name);
      let value = input;
      for (const step of steps) {
        const result = await runStep(name, options, step, value);
        if (result.ok) value = result.value;
      }
      return value;
    },

    /**
     * @param {string} name
     * @param {unknown} input
     * @returns {Promise<{ id: string, value: unknown }[]>}
     */
    async collect(name, input) {
      const { options, steps } = chainOf(name);
      const results = await Promise.all(steps.map((step) => runStep(name, options, step, input)));
      return results.flatMap((result, i) =>
        result.ok ? [{ id: steps.at(i)?.id ?? '', value: result.value }] : [],
      );
    },

    /** @param {string} name */
    steps: (name) => chainOf(name).steps.map((step) => step.id),
  };
}

/** @typedef {ReturnType<typeof createPipelines>} Pipelines */
