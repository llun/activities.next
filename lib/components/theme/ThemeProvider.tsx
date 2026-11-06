'use client'

import {
  FC,
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'

import {
  THEME_STORAGE_KEY,
  type ThemeMode,
  applyTheme,
  applyThemeColor,
  getStoredTheme,
  storeTheme
} from './theme-core'

interface ThemeContextValue {
  // The chosen mode: 'light' | 'dark' | 'system'. Initialized to 'system' on the
  // server and first client render, then reconciled from localStorage on mount.
  theme: ThemeMode
  // The resolved appearance (true when `.dark` is applied). In `system` mode
  // this tracks the OS setting live.
  isDark: boolean
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

interface ThemeProviderProps {
  children: ReactNode
}

const THEME_COLOR_META = 'meta[name="theme-color"]'

// Whether a head mutation involves a theme-color meta: its own media or
// content changed, or one was added (alone, or inside an added subtree).
const touchesThemeColor = (record: MutationRecord): boolean =>
  (record.target instanceof Element &&
    record.target.matches(THEME_COLOR_META)) ||
  Array.from(record.addedNodes).some(
    (node) =>
      node instanceof Element &&
      (node.matches(THEME_COLOR_META) ||
        node.querySelector(THEME_COLOR_META) !== null)
  )

export const ThemeProvider: FC<ThemeProviderProps> = ({ children }) => {
  // The server and first client render both use `system` so the hydrated markup
  // matches; the real persisted value is read in the mount effect below. The
  // actual page appearance is already correct at this point because the inline
  // THEME_INIT_SCRIPT set the `.dark` class before React hydrated.
  const [theme, setThemeState] = useState<ThemeMode>('system')
  const [isDark, setIsDark] = useState(false)
  // The mode in force for this visit. The head observer and the OS listener
  // read it, not localStorage: where storage writes fail (private mode), a
  // choice made this session must still hold.
  const modeRef = useRef<ThemeMode>('system')

  // Reconcile React state with the DOM/localStorage after hydration.
  useEffect(() => {
    const stored = getStoredTheme()
    modeRef.current = stored
    setThemeState(stored)
    setIsDark(document.documentElement.classList.contains('dark'))
    // The theme-color metas can arrive after THEME_INIT_SCRIPT ran (streamed
    // metadata), so their colour is applied, or restored for system, here.
    applyThemeColor(stored)
  }, [])

  // Next re-renders the viewport metas on a client-side navigation and puts
  // their media-scoped `media` back, which would undo an explicit choice for
  // the rest of the visit. Reapply when a theme-color meta changes or is added;
  // applyThemeColor writes only what differs, so its own writes settle instead
  // of looping.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver((records) => {
      if (records.some(touchesThemeColor)) applyThemeColor(modeRef.current)
    })
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['media', 'content']
    })
    return () => observer.disconnect()
  }, [])

  const setTheme = useCallback((mode: ThemeMode) => {
    modeRef.current = mode
    storeTheme(mode)
    setThemeState(mode)
    setIsDark(applyTheme(mode))
  }, [])

  // Follow the OS setting live while in `system` mode (no reload needed).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (modeRef.current === 'system') setIsDark(applyTheme('system'))
    }
    // Safari/iOS < 14 only implement the legacy addListener/removeListener API.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    query.addListener(onChange)
    return () => query.removeListener(onChange)
  }, [])

  // Keep every open tab in sync: a change in one tab fires `storage` in the
  // others, where we re-read and re-apply the new choice.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return
      const stored = getStoredTheme()
      modeRef.current = stored
      setThemeState(stored)
      setIsDark(applyTheme(stored))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, isDark, setTheme }}>
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
