/** A browser Storage implementation whose lifetime is the current demo page. */
export function createMemoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)) },
    removeItem: key => { values.delete(String(key)) },
    clear: () => values.clear(),
  }
}
