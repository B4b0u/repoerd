import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'repoerd:theme'

/** Dark unless the user explicitly picked light. */
export function resolveTheme(stored: string | null): Theme {
  return stored === 'light' ? 'light' : 'dark'
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}

function readStoredTheme(): Theme {
  try {
    return resolveTheme(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'dark'
  }
}

/** Applies the theme as `data-theme` on <html> and remembers the user's choice. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // Storage may be unavailable (private mode); the theme still applies for this session.
    }
  }, [theme])

  const toggle = useCallback(() => setTheme(nextTheme), [])
  return { theme, toggle }
}
