/**
 * [Inc-24] Move the row at `index` by `delta` and return the FULL id list in its new order — exactly what
 * `PATCH /v1/catalog/reorder` expects (the server renumbers `sortOrder` to the array index, 0..n-1).
 * Returns null when the move would fall off either end, so callers can no-op.
 */
export function reorderedIds<T extends { id: string }>(rows: readonly T[], index: number, delta: number): string[] | null {
  const target = index + delta;
  const a = rows[index];
  const b = rows[target];
  if (!a || !b) return null;
  const next = [...rows];
  next[index] = b;
  next[target] = a;
  return next.map((r) => r.id);
}
