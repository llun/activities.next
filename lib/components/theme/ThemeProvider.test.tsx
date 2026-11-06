/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { StrictMode } from 'react'

import { ThemeProvider, useTheme } from './ThemeProvider'
import {
  THEME_COLOR_DARK,
  THEME_COLOR_DARK_MEDIA,
  THEME_COLOR_LIGHT,
  THEME_COLOR_LIGHT_MEDIA,
  THEME_STORAGE_KEY
} from './theme-core'

const Consumer = () => {
  const { theme, isDark, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="isDark">{String(isDark)}</span>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('light')}>light</button>
    </div>
  )
}

const renderProvider = () =>
  render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>
  )

describe('ThemeProvider', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = ''
  })

  it('reconciles the persisted theme from localStorage on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    renderProvider()
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  it('applies the dark class and persists when set to dark', () => {
    renderProvider()
    fireEvent.click(screen.getByRole('button', { name: 'dark' }))
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByTestId('isDark')).toHaveTextContent('true')
  })

  it('removes the dark class when set to light', () => {
    document.documentElement.classList.add('dark')
    renderProvider()
    fireEvent.click(screen.getByRole('button', { name: 'light' }))
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(screen.getByTestId('isDark')).toHaveTextContent('false')
  })

  it('syncs the choice across tabs via the storage event', () => {
    renderProvider()
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY })
      )
    })
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('ignores storage events for unrelated keys', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderProvider()
    // Change the stored value first, then fire an event for an unrelated key:
    // the handler must ignore it and NOT adopt the new 'dark' value. (Without
    // the key guard it would re-read localStorage and flip to dark, so this
    // assertion actually exercises the guard.)
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      window.dispatchEvent(new StorageEvent('storage', { key: 'other-key' }))
    })
    expect(screen.getByTestId('theme')).toHaveTextContent('light')
  })

  describe('theme-color metas on mount', () => {
    // As the server renders them; `media` is what an earlier script or an
    // older page left behind.
    const renderMetas = (lightMedia: string, darkMedia: string) => {
      document.head.innerHTML =
        `<meta name="theme-color" media="${lightMedia}" content="${THEME_COLOR_LIGHT}">` +
        `<meta name="theme-color" media="${darkMedia}" content="${THEME_COLOR_DARK}">`
    }
    const medias = () =>
      Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(
        (meta) => meta.getAttribute('media')
      )

    afterEach(() => {
      document.head.innerHTML = ''
    })

    it('restores the media-scoped pair in system mode', () => {
      renderMetas('not all', 'all')

      renderProvider()

      expect(medias()).toEqual([
        THEME_COLOR_LIGHT_MEDIA,
        THEME_COLOR_DARK_MEDIA
      ])
    })

    // A client-side navigation re-renders the viewport metas with their
    // media-scoped `media`: the explicit choice must come back, not stay lost.
    it('restores an explicit choice when a navigation resets the metas', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()
      expect(medias()).toEqual(['not all', 'all'])

      for (const meta of Array.from(
        document.querySelectorAll('meta[name="theme-color"]')
      )) {
        meta.setAttribute(
          'media',
          meta.getAttribute('content') === THEME_COLOR_DARK
            ? THEME_COLOR_DARK_MEDIA
            : THEME_COLOR_LIGHT_MEDIA
        )
      }

      await waitFor(() => expect(medias()).toEqual(['not all', 'all']))
    })

    it('restores an explicit choice on metas that are put back', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'light')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()

      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)

      await waitFor(() => expect(medias()).toEqual(['all', 'not all']))
    })

    // Its own writes notify the observer too: they must settle, not loop.
    it('settles after restoring instead of rewriting for ever', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()
      // Capped, so a regression fails here instead of hanging the run: an
      // observer that rewrites unconditionally re-triggers itself for ever.
      const original = Element.prototype.setAttribute
      const setAttribute = vi
        .spyOn(Element.prototype, 'setAttribute')
        .mockImplementation(function (
          this: Element,
          name: string,
          value: string
        ) {
          if (setAttribute.mock.calls.length > 50) {
            throw new Error('theme-color observer loop')
          }
          original.call(this, name, value)
        })

      try {
        renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
        await waitFor(() => expect(medias()).toEqual(['not all', 'all']))
        const writes = setAttribute.mock.calls.length
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(setAttribute.mock.calls.length).toBe(writes)
        expect(writes).toBe(2)
      } finally {
        setAttribute.mockRestore()
      }
    })

    // System mode is watched too: a writer that flattens the pair (as the
    // old pre-paint script did) is put back to the media-scoped values.
    it('restores the media-scoped pair in system mode after a rogue write', async () => {
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()

      for (const meta of Array.from(
        document.querySelectorAll('meta[name="theme-color"]')
      )) {
        meta.setAttribute('media', 'all')
      }

      await waitFor(() =>
        expect(medias()).toEqual([
          THEME_COLOR_LIGHT_MEDIA,
          THEME_COLOR_DARK_MEDIA
        ])
      )
    })

    // Where localStorage writes fail (private mode), the observer must keep
    // the choice made this session, not revert to the stored one.
    it('keeps an in-session choice when it could not be stored', async () => {
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new Error('QuotaExceededError')
        })
      try {
        fireEvent.click(screen.getByRole('button', { name: 'dark' }))
      } finally {
        setItem.mockRestore()
      }
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
      expect(medias()).toEqual(['not all', 'all'])

      // A navigation puts the system pair back.
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)

      await waitFor(() => expect(medias()).toEqual(['not all', 'all']))
    })

    // Only theme-color metas matter: other head churn (styles, scripts) does
    // not even make it look for them.
    it('ignores head mutations that involve no theme-color meta', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      renderProvider()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const lookups = vi.spyOn(document, 'querySelectorAll')
      try {
        const style = document.createElement('style')
        document.head.appendChild(style)
        style.setAttribute('media', 'print')
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(lookups).not.toHaveBeenCalledWith('meta[name="theme-color"]')
      } finally {
        lookups.mockRestore()
      }
    })

    // React StrictMode mounts, unmounts and remounts effects in development:
    // one observer must be left watching, not two.
    it('leaves one observer under StrictMode', () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe')
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
      try {
        render(
          <StrictMode>
            <ThemeProvider>
              <Consumer />
            </ThemeProvider>
          </StrictMode>
        )

        expect(observe.mock.calls.length - disconnect.mock.calls.length).toBe(1)
      } finally {
        observe.mockRestore()
        disconnect.mockRestore()
      }
    })

    it('stops watching the head once unmounted', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      const { unmount } = renderProvider()
      unmount()

      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(medias()).toEqual([
        THEME_COLOR_LIGHT_MEDIA,
        THEME_COLOR_DARK_MEDIA
      ])
    })

    // Streamed metadata can land after the pre-paint script ran.
    it('applies an explicit choice to metas that arrived after the script', () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      renderMetas(THEME_COLOR_LIGHT_MEDIA, THEME_COLOR_DARK_MEDIA)

      renderProvider()

      expect(medias()).toEqual(['not all', 'all'])
    })
  })

  it('throws when useTheme is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(
      /useTheme must be used within a ThemeProvider/
    )
    spy.mockRestore()
  })
})
