// @ts-check
import { monitorEventLoopDelay } from 'node:perf_hooks';
import v8 from 'node:v8';

/**
 * Overload protection (Phase 14). The 10x load test ran the API out of heap: under sustained
 * overload, accepted work queued in memory until V8 aborted the process, dropping every
 * socket. Instead, while the process is under pressure, new HTTP requests get 503
 * TEMPORARILY_UNAVAILABLE (with Retry-After) and new sockets are refused; work already
 * accepted finishes. Health checks are never shed.
 *
 * Pressure: the mean event-loop delay over the last window, or the heap used as a share of
 * V8's heap limit, is above its threshold. Sampled every `windowMs`, so a check is free.
 * @param {{ maxEventLoopDelayMs: number, maxHeapRatio: number, windowMs?: number, heapLimitBytes?: number, heapUsed?: () => number }} options
 */
export function createPressureGauge({
  maxEventLoopDelayMs,
  maxHeapRatio,
  windowMs = 1000,
  heapLimitBytes = v8.getHeapStatistics().heap_size_limit,
  heapUsed = () => process.memoryUsage().heapUsed,
}) {
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  /** @type {null | 'event_loop' | 'heap'} */
  let reason = null;
  const sample = () => {
    const meanMs = delay.mean / 1e6;
    delay.reset();
    reason =
      heapUsed() / heapLimitBytes > maxHeapRatio
        ? 'heap'
        : meanMs > maxEventLoopDelayMs
          ? 'event_loop'
          : null;
  };
  const timer = setInterval(sample, windowMs);
  timer.unref();
  return {
    /** Why the process is shedding load now, or null. */
    overloaded: () => reason,
    /** Re-samples at once (tests). */
    sample,
    stop: () => {
      clearInterval(timer);
      delay.disable();
    },
  };
}

/** @typedef {ReturnType<typeof createPressureGauge>} PressureGauge */
