export function groupBy<T, K extends string>(values: readonly T[], getKey: (value: T) => K) {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}
