/**
 * @vitest-environment jsdom
 */
import {
  THEME_COLOR_DARK,
  THEME_COLOR_DARK_MEDIA,
  THEME_COLOR_LIGHT,
  THEME_COLOR_LIGHT_MEDIA,
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
        '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">' +
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a">'

      applyTheme('dark')

      expect(
        Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
          (meta) => meta.getAttribute('media')
        )
      ).toEqual(['not all', 'all'])
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

    const state = () =>
      metas().map((meta) => [
        meta.getAttribute('media'),
        meta.getAttribute('content')
      ])

    // The content is what React matches the server's node by on hydration,
    // so only the media changes.
    it('turns on only the dark meta for an explicit dark choice', () => {
      renderMetas()

      applyThemeColor('dark')

      expect(state()).toEqual([
        ['not all', THEME_COLOR_LIGHT],
        ['all', THEME_COLOR_DARK]
      ])
    })

    it('turns on only the light meta for an explicit light choice', () => {
      renderMetas()

      applyThemeColor('light')

      expect(state()).toEqual([
        ['all', THEME_COLOR_LIGHT],
        ['not all', THEME_COLOR_DARK]
      ])
    })

    it('restores the media-scoped pair for system', () => {
      renderMetas()
      applyThemeColor('dark')

      applyThemeColor('system')

      expect(state()).toEqual([
        [THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_LIGHT],
        [THEME_COLOR_DARK_MEDIA, THEME_COLOR_DARK]
      ])
    })

    // Next renders the two media-scoped metas; a third one beside them would
    // make the browser's pick depend on document order.
    it.each(['light', 'dark', 'system'] as const)(
      'never adds a meta (%s)',
      (mode) => {
        renderMetas()
        applyThemeColor(mode)
        expect(metas()).toHaveLength(2)

        document.head.innerHTML = ''
        applyThemeColor(mode)
        expect(metas()).toHaveLength(0)
      }
    )
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

    describe('theme-color metas', () => {
      const renderServerMetas = () => {
        document.head.innerHTML =
          '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff">' +
          '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a">'
      }
      const contents = () =>
        Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
          (meta) => meta.getAttribute('content')
        )

      afterEach(() => {
        document.head.innerHTML = ''
      })

      // System mode: the server's media-scoped pair is already right, so the
      // script must not flatten it to the scheme it resolved at load.
      it('leaves the media-scoped metas alone in system mode', () => {
        renderServerMetas()
        vi.stubGlobal('matchMedia', () => ({ matches: true }))

        new Function(THEME_INIT_SCRIPT)()

        vi.unstubAllGlobals()
        expect(contents()).toEqual([THEME_COLOR_LIGHT, THEME_COLOR_DARK])
      })

      it('turns on only the chosen colour for an explicit choice', () => {
        renderServerMetas()
        localStorage.setItem(THEME_STORAGE_KEY, 'dark')

        new Function(THEME_INIT_SCRIPT)()

        expect(contents()).toEqual([THEME_COLOR_LIGHT, THEME_COLOR_DARK])
        expect(
          Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
            (meta) => meta.getAttribute('media')
          )
        ).toEqual(['not all', 'all'])
      })

      it('never adds a meta, even before the metas have arrived', () => {
        localStorage.setItem(THEME_STORAGE_KEY, 'dark')

        new Function(THEME_INIT_SCRIPT)()

        expect(contents()).toEqual([])
      })
    })
  })
})
