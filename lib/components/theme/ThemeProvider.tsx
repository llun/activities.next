'use client'

import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react'

import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  applyTheme,
  getStoredTheme,
  storeTheme
} from './theme-core'

interface ThemeContextValue {
  // The chosen mode: 'light' | 'dark' | 'system'.
  theme: ThemeMode
  // The resolved appearance (true when `.dark` is applied). In `system` mode
  // this tracks the OS setting live.
  isDark: boolean
  // Set once the client effect has read the persisted choice. Consumers gate
  // their active-state rendering on this to avoid a hydration mismatch, since
  // the server can't know the per-device localStorage value.
  mounted: boolean
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

interface ThemeProviderProps {
  children: ReactNode
}

export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  // The server and first client render both use `system` so the hydrated markup
  // matches; the real persisted value is read in the mount effect below. The
  // actual page appearance is already correct at this point because the inline
  // THEME_INIT_SCRIPT set the `.dark` class before React hydrated.
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [isDark, setIsDark] = useState(false)
  const [mounted, setMounted] = useState(false)

  // Sync React state from the DOM/localStorage after hydration.
  useEffect(() => {
    setThemeState(getStoredTheme())
    setIsDark(document.documentElement.classList.contains('dark'))
    setMounted(true)
  }, [])

  const setTheme = useCallback((mode: ThemeMode) => {
    storeTheme(mode)
    setThemeState(mode)
    setIsDark(applyTheme(mode))
  }, [])

  // Follow the OS setting live while in `system` mode (no reload needed).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (getStoredTheme() === 'system') setIsDark(applyTheme('system'))
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Keep every open tab in sync: a change in one tab fires `storage` in the
  // others, where we re-read and re-apply the new choice.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      const stored = getStoredTheme()
      setThemeState(stored)
      setIsDark(applyTheme(stored))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, isDark, mounted, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
