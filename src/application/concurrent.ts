export const CATALOGUE_CONCURRENCY = 2;

/** Bound read-only work, preserve input order, and settle started reads before returning a failure. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  read: (item: T, index: number) => Promise<R>,
  concurrency = CATALOGUE_CONCURRENCY,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0,
    failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        output[index] = await read(items[index], index);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      worker,
    ),
  );
  if (failed) throw failure;
  return output;
}
