/** Returns a copy of `record` without `key` (immutable alternative to `delete`). */
export function omitKey<Value>(record: Readonly<Record<string, Value>>, key: string): Record<string, Value> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}
