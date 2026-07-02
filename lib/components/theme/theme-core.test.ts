/**
 * @vitest-environment jsdom
 */
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  getStoredTheme,
  isThemeMode,
  resolveIsDark,
  storeTheme
} from './theme-core'

describe('theme-core', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  describe('isThemeMode', () => {
    it.each([
      { description: 'light', value: 'light', expected: true },
      { description: 'dark', value: 'dark', expected: true },
      { description: 'system', value: 'system', expected: true },
      { description: 'an unknown string', value: 'sepia', expected: false },
      { description: 'null', value: null, expected: false },
      { description: 'a number', value: 1, expected: false }
    ])('returns $expected for $description', ({ value, expected }) => {
      expect(isThemeMode(value)).toBe(expected)
    })
  })

  describe('getStoredTheme', () => {
    it('defaults to system when nothing is stored', () => {
      expect(getStoredTheme()).toBe('system')
    })

    it('returns the persisted mode', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      expect(getStoredTheme()).toBe('dark')
    })

    it('falls back to system for an invalid stored value', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'not-a-mode')
      expect(getStoredTheme()).toBe('system')
    })
  })

  describe('storeTheme', () => {
    it('persists the mode under the anext-theme key', () => {
      storeTheme('light')
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    })
  })

  describe('resolveIsDark', () => {
    it.each([
      {
        description: 'dark mode resolves dark regardless of the OS',
        mode: 'dark' as const,
        prefersDark: false,
        expected: true
      },
      {
        description: 'light mode resolves light regardless of the OS',
        mode: 'light' as const,
        prefersDark: true,
        expected: false
      },
      {
        description: 'system follows an OS that prefers dark',
        mode: 'system' as const,
        prefersDark: true,
        expected: true
      },
      {
        description: 'system follows an OS that prefers light',
        mode: 'system' as const,
        prefersDark: false,
        expected: false
      }
    ])('$description', ({ mode, prefersDark, expected }) => {
      expect(resolveIsDark(mode, prefersDark)).toBe(expected)
    })
  })

  describe('applyTheme', () => {
    it('adds the dark class and color-scheme for dark mode', () => {
      expect(applyTheme('dark')).toBe(true)
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('removes the dark class for light mode', () => {
      document.documentElement.classList.add('dark')
      expect(applyTheme('light')).toBe(false)
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })

  describe('THEME_INIT_SCRIPT', () => {
    it('references the storage key so the pre-paint script and helpers agree', () => {
      expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY)
    })

    it('applies a stored dark preference when executed before hydration', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      // Executes the inline IIFE exactly as the browser would at the top of
      // <body>, proving it toggles the class without throwing.
      new Function(THEME_INIT_SCRIPT)()
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })
  })
})
