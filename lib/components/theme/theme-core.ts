// Framework-agnostic theming primitives shared by the anti-FOUC init script,
// the React ThemeProvider, and the ThemeControl switcher. The product supports
// three modes — light, dark, and system (follows the OS) — persisted per device
// in localStorage under `anext-theme`. Dark mode is expressed by toggling the
// `.dark` class on <html>, which flips the CSS custom properties in globals.css.

export const THEME_STORAGE_KEY = 'anext-theme'

export type ThemeMode = 'light' | 'dark' | 'system'

// System is listed last so the two explicit modes stay adjacent in the switcher.
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

export const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'light' || value === 'dark' || value === 'system'

// Reads the persisted mode, defaulting to `system`. Wrapped in try/catch because
// localStorage access throws in some privacy modes / sandboxed iframes.
export const getStoredTheme = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return isThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export const storeTheme = (mode: ThemeMode): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    // Persisting is best-effort; the in-memory choice still applies for the tab.
  }
}

export const systemPrefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

// Resolves a mode to a concrete light/dark boolean. `prefersDark` is injectable
// so callers can pass a memoized media-query result (and so it stays testable).
export const resolveIsDark = (
  mode: ThemeMode,
  prefersDark: boolean = systemPrefersDark()
): boolean => mode === 'dark' || (mode === 'system' && prefersDark)

// Applies the resolved theme to <html>: toggles `.dark` (drives the CSS
// variables) and sets `color-scheme` so native form controls / scrollbars match.
// Returns the resolved dark boolean for callers that track it in state.
export const applyTheme = (mode: ThemeMode): boolean => {
  const dark = resolveIsDark(mode)
  // Only ever called from client effects/handlers today, but guard the DOM
  // access for SSR safety and consistency with the window/localStorage guards
  // above so the helper stays safe if it is ever reused server-side.
  if (typeof document === 'undefined') return dark
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

// Inline script injected at the top of <body> so the theme is applied before the
// first paint — otherwise a stored dark preference would flash a light page on
// every load. Kept dependency-free and self-contained (it runs before any bundle
// loads) and mirrors the logic above. Allowed by the `script-src 'unsafe-inline'`
// directive in the app CSP.
export const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var m=localStorage.getItem(k);if(m!=='light'&&m!=='dark'&&m!=='system')m='system';var d=m==='dark'||(m==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`
