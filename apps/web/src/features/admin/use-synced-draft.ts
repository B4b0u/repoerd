import { useEffect, useRef, useState } from 'react'

/**
 * A field's draft that follows the saved value while untouched (after a save, or a change made
 * elsewhere), and keeps the user's text once edited.
 */
export function useSyncedDraft(saved: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(saved)
  const synced = useRef(saved)
  useEffect(() => {
    // Read before the updater runs: React calls it later, once the ref points at the new value.
    const previous = synced.current
    synced.current = saved
    setDraft((current) => (current === previous ? saved : current))
  }, [saved])
  return [draft, setDraft]
}
