/**
 * Strip keys whose value is `undefined`. Useful for assembling object
 * literals with optional fields under `exactOptionalPropertyTypes`,
 * where `{ x: undefined }` is not assignable to `{ x?: T }`.
 */
export function omitUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], undefined> };
}
