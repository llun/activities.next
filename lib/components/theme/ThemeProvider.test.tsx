/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { ThemeProvider, useTheme } from './ThemeProvider'
import { THEME_STORAGE_KEY } from './theme-core'

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

  it('throws when useTheme is used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Consumer />)).toThrow(
      /useTheme must be used within a ThemeProvider/
    )
    spy.mockRestore()
  })
})
