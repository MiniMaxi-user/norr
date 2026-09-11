import "server-only";

/**
 * Coarse server-side timing (issue #150, performance breakdown from #139) —
 * this story lands FIRST specifically so #149/#148/#147/#151 have a
 * before/after number once they land; it deliberately does nothing beyond
 * that. `console.time`/`console.timeEnd` are NOT used here on purpose: both
 * key off a single global label, so two concurrent requests hitting the same
 * call site (e.g. two Work Order detail page loads at once, both timing
 * "work-order-detail:fetch") would clobber each other's start time in the
 * same server process — `performance.now()` deltas captured in a closure
 * don't have that problem. Output lands wherever this app's other
 * `console.log` calls already do: Vercel's Runtime Logs for a deployed
 * function, or the terminal running `next dev`/`next start` locally — no new
 * log sink, no new dependency.
 */
export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const durationMs = performance.now() - start;
    console.log(`[timing] ${label}: ${durationMs.toFixed(1)}ms`);
  }
}
