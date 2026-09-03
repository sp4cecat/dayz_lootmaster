/**
 * Run `fn` over `items` with at most `limit` in flight, preserving result order.
 *
 * The boot pipeline's per-file fetch loops were `await`-in-`for`, so every file cost
 * a full HTTP round trip plus an SMB round trip with no pipelining — pathological
 * against a LAN share. The default limit of 6 matches the browser's per-origin
 * connection cap; going higher just queues in the network stack instead.
 *
 * `fn` is expected to handle its own failures. A rejection propagates (rejecting the
 * returned promise) while the remaining workers continue, so callers that need
 * partial results must catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    const workerCount = Math.max(1, Math.min(limit, items.length));
    const workers = Array.from({ length: workerCount }, async () => {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await fn(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
}

/** Default in-flight cap: the browser's per-origin connection limit. */
export const DEFAULT_CONCURRENCY = 6;
