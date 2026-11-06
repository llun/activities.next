// Framework-agnostic theming primitives shared by the anti-FOUC init script,
// the React ThemeProvider, and the ThemeControl switcher. The product supports
// three modes — light, dark, and system (follows the OS) — persisted per device
// in localStorage under `anext-theme`. Dark mode is expressed by toggling the
// `.dark` class on <html>, which flips the CSS custom properties in globals.css.

export const THEME_STORAGE_KEY = 'anext-theme'

// The live `<meta name="theme-color">` values. Next renders one per colour
// scheme from `viewport.themeColor` in app/layout.tsx; an explicit light/dark
// choice has to win over the OS preference, so `applyThemeColor` rewrites them.
export const THEME_COLOR_LIGHT = '#ffffff'
export const THEME_COLOR_DARK = '#0a0a0a'

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
  applyThemeColor(mode)
  return dark
}

// Keeps the browser chrome (and an installed PWA's title bar) in step with the
// resolved theme. `system` restores the media-scoped values Next rendered; an
// explicit choice writes the same colour to every meta, so the OS preference
// cannot override it.
export const applyThemeColor = (mode: ThemeMode): void => {
  if (typeof document === 'undefined') return
  const color = resolveIsDark(mode) ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
  const metas = Array.from(
    document.querySelectorAll('meta[name="theme-color"]')
  )
  if (metas.length === 0) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', color)
    document.head.appendChild(meta)
    return
  }
  for (const meta of metas) {
    if (mode === 'system') {
      const media = meta.getAttribute('media') ?? ''
      if (media.includes('dark')) meta.setAttribute('content', THEME_COLOR_DARK)
      else if (media.includes('light'))
        meta.setAttribute('content', THEME_COLOR_LIGHT)
      else meta.setAttribute('content', color)
      continue
    }
    meta.setAttribute('content', color)
  }
}

// Inline script injected at the top of <body> so the theme is applied before the
// first paint — otherwise a stored dark preference would flash a light page on
// every load. Kept dependency-free and self-contained (it runs before any bundle
// loads) and mirrors the logic above. Allowed by the `script-src 'unsafe-inline'`
// directive in the app CSP.
export const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var m=localStorage.getItem(k);if(m!=='light'&&m!=='dark'&&m!=='system')m='system';var d=m==='dark'||(m==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';var c=d?'${THEME_COLOR_DARK}':'${THEME_COLOR_LIGHT}';var ms=document.querySelectorAll('meta[name="theme-color"]');if(!ms.length){var t=document.createElement('meta');t.setAttribute('name','theme-color');t.setAttribute('content',c);document.head.appendChild(t);}else{for(var i=0;i<ms.length;i++){ms[i].setAttribute('content',c);}}}catch(e){}})();`
