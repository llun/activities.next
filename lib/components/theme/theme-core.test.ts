/**
 * @vitest-environment jsdom
 */
import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  applyThemeColor,
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

    // ThemeProvider applies the reader's explicit choice through applyTheme,
    // so the browser chrome follows it rather than the OS preference.
    it('repaints the theme-color meta for the chosen mode', () => {
      document.head.innerHTML =
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">'

      applyTheme('dark')

      expect(
        document
          .querySelector('meta[name="theme-color"]')
          ?.getAttribute('content')
      ).toBe(THEME_COLOR_DARK)
      document.head.innerHTML = ''
    })
  })

  describe('applyThemeColor', () => {
    const metas = () =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]'))

    const renderMetas = () => {
      document.head.innerHTML = ''
      for (const [media, color] of [
        ['(prefers-color-scheme: light)', THEME_COLOR_LIGHT],
        ['(prefers-color-scheme: dark)', THEME_COLOR_DARK]
      ]) {
        const meta = document.createElement('meta')
        meta.setAttribute('name', 'theme-color')
        meta.setAttribute('media', media)
        meta.setAttribute('content', color)
        document.head.appendChild(meta)
      }
    }

    afterEach(() => {
      document.head.innerHTML = ''
    })

    it('writes the dark colour to every meta for an explicit dark choice', () => {
      renderMetas()

      applyThemeColor('dark')

      expect(metas().map((meta) => meta.getAttribute('content'))).toEqual([
        THEME_COLOR_DARK,
        THEME_COLOR_DARK
      ])
    })

    it('writes the light colour to every meta for an explicit light choice', () => {
      renderMetas()

      applyThemeColor('light')

      expect(metas().map((meta) => meta.getAttribute('content'))).toEqual([
        THEME_COLOR_LIGHT,
        THEME_COLOR_LIGHT
      ])
    })

    it('restores the media-scoped values for system', () => {
      renderMetas()
      applyThemeColor('dark')

      applyThemeColor('system')

      expect(metas().map((meta) => meta.getAttribute('content'))).toEqual([
        THEME_COLOR_LIGHT,
        THEME_COLOR_DARK
      ])
    })

    it('creates the meta when the document has none', () => {
      document.head.innerHTML = ''

      applyThemeColor('dark')

      expect(metas()).toHaveLength(1)
      expect(metas()[0].getAttribute('content')).toBe(THEME_COLOR_DARK)
    })
  })

  describe('THEME_INIT_SCRIPT', () => {
    it('applies a stored dark preference when executed before hydration', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      // Executes the inline IIFE exactly as the browser would at the top of
      // <body>, proving it toggles the class without throwing.
      new Function(THEME_INIT_SCRIPT)()
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('clears dark for a light preference (catches an always-dark regression)', () => {
      document.documentElement.classList.add('dark')
      localStorage.setItem(THEME_STORAGE_KEY, 'light')
      new Function(THEME_INIT_SCRIPT)()
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.style.colorScheme).toBe('light')
    })
  })
})
