/**
 * Maps over `items`, running at most `concurrency` invocations of `fn` at the
 * same time. Results preserve input order regardless of completion order.
 *
 * Used to parallelize independent, latency-bound work (e.g. Claude vision
 * calls per PDF page/crop) that was previously awaited one at a time in a
 * `for` loop — turning N sequential round-trips into ceil(N / concurrency).
 */
const exclusiveLocks = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` only after any previous call sharing the same `key` has settled —
 * a simple in-process mutex. Used to serialize read-modify-write file I/O
 * (e.g. a shared manifest.json) when the surrounding code now processes
 * several independent items (windows/pages) concurrently, so two writers
 * for the same key never race and silently drop each other's changes.
 */
export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = exclusiveLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  // Swallow rejection here only so it doesn't leak as an unhandled rejection
  // on the lock chain itself — the real error still propagates to the caller
  // of `runExclusive` via the returned `run` promise.
  exclusiveLocks.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  if (!items.length) return results;
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
