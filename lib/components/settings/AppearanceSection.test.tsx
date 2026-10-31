/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ThemeProvider } from '@/lib/components/theme'

import { AppearanceSection } from './AppearanceSection'

const renderSection = () =>
  render(
    <ThemeProvider>
      <AppearanceSection />
    </ThemeProvider>
  )

describe('AppearanceSection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    try {
      window.localStorage.clear()
    } catch {
      // Storage can be unavailable; the section works without it.
    }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the Saved tick once a theme is picked, and clears it after a moment', () => {
    renderSection()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: /^Dark/ }))

    expect(status).toHaveTextContent('Saved')

    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(status).toBeEmptyDOMElement()
  })

  it('applies the picked theme to the control straight away', () => {
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: /^Dark/ }))

    expect(screen.getByRole('button', { name: /^Dark/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /^Light/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  it('keeps the tick up when a second pick lands before the first one clears', () => {
    renderSection()
    const status = screen.getByRole('status')

    fireEvent.click(screen.getByRole('button', { name: /^Dark/ }))
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    fireEvent.click(screen.getByRole('button', { name: /^Light/ }))
    act(() => {
      vi.advanceTimersByTime(1500)
    })

    // 3s since the first pick, but only 1.5s since the second.
    expect(status).toHaveTextContent('Saved')
  })

  it('describes the theme control with its hint', () => {
    renderSection()

    expect(
      screen.getByRole('group', { name: 'Theme' })
    ).toHaveAccessibleDescription(/Saved instantly on this device/)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Theme' })
    ).toBeInTheDocument()
  })
})
