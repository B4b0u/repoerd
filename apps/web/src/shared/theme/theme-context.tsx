import { createContext, type ReactNode, useContext } from 'react'
import { type Theme, useTheme } from './theme'

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'dark',
  toggle: () => {},
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={useTheme()}>{children}</ThemeContext.Provider>
}

export const useThemeContext = () => useContext(ThemeContext)
