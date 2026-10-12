export function filterTables(names: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...names]
  return names.filter((name) => name.toLowerCase().includes(needle))
}
