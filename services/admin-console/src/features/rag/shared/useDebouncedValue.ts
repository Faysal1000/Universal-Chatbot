import { useEffect, useState } from 'react';

/** The value once it has stopped changing for `delayMilliseconds` (for search-as-you-type). */
export function useDebouncedValue<Value>(value: Value, delayMilliseconds: number): Value {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMilliseconds);
    return () => clearTimeout(timer);
  }, [value, delayMilliseconds]);
  return debouncedValue;
}
