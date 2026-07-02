/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReactElement } from 'react'

import { ThemeControl } from './ThemeControl'
import { ThemeProvider } from './ThemeProvider'
import { THEME_STORAGE_KEY } from './theme-core'

const renderWithTheme = (ui: ReactElement) =>
  render(<ThemeProvider>{ui}</ThemeProvider>)

describe('ThemeControl', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    // Reset color-scheme too: clicking a segment sets it via applyTheme, and
    // leaking it across files could affect other suites (matches the reset in
    // the sibling ThemeProvider/theme-core tests).
    document.documentElement.style.colorScheme = ''
  })

  it('renders the three theme options in the labelled group', () => {
    renderWithTheme(<ThemeControl />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(
      within(group).getByRole('button', { name: 'Light' })
    ).toBeInTheDocument()
    expect(
      within(group).getByRole('button', { name: 'Dark' })
    ).toBeInTheDocument()
    expect(
      within(group).getByRole('button', { name: 'System' })
    ).toBeInTheDocument()
  })

  it('marks the clicked mode active and applies it', () => {
    renderWithTheme(<ThemeControl />)
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(document.documentElement).toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('reflects the persisted mode as the active segment', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderWithTheme(<ThemeControl />)
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('renders icon-only labelled buttons in the compact variant', () => {
    renderWithTheme(<ThemeControl variant="compact" />)
    // The compact pill exposes labels via aria-label ("<Mode> theme"), not
    // visible text, so screen readers still announce each segment.
    expect(
      screen.getByRole('button', { name: 'Light theme' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Dark theme' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'System theme' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Light')).not.toBeInTheDocument()
  })
})
