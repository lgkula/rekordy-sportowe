/** True for a MySQL duplicate key error (also when Drizzle wraps the driver error). */
export function isDuplicateEntry(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return e.code === 'ER_DUP_ENTRY' || e.cause?.code === 'ER_DUP_ENTRY';
}
