/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { YearChooser } from './YearChooser'

const openMenu = () =>
  fireEvent.keyDown(screen.getByRole('button', { name: /Calendar year/ }), {
    key: 'Enter'
  })

describe('YearChooser', () => {
  it('is labelled and shows the current year', () => {
    render(
      <YearChooser years={[2026, 2025, 2024]} value={2026} onSelect={vi.fn()} />
    )
    const trigger = screen.getByRole('button', { name: 'Calendar year 2026' })
    expect(trigger).toHaveTextContent('2026')
  })

  it('shows a placeholder without a value', () => {
    render(<YearChooser years={[2026]} value={null} onSelect={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Calendar year/ })
    ).toHaveTextContent('Select year')
  })

  it('lists the given years newest first and checks the current one', async () => {
    render(
      <YearChooser years={[2026, 2025, 2024]} value={2025} onSelect={vi.fn()} />
    )
    openMenu()
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual([
      '2026',
      '2025',
      '2024'
    ])
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false'
    ])
  })

  it('reports the chosen year', async () => {
    const onSelect = vi.fn()
    render(
      <YearChooser
        years={[2026, 2025, 2024]}
        value={2026}
        onSelect={onSelect}
      />
    )
    openMenu()
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '2024' }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2024)
  })

  it('offers 44px targets on touch only when asked to', async () => {
    const { rerender } = render(
      <YearChooser years={[2026]} value={2026} onSelect={vi.fn()} touch />
    )
    expect(screen.getByRole('button', { name: /Calendar year/ })).toHaveClass(
      'h-11'
    )
    rerender(<YearChooser years={[2026]} value={2026} onSelect={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Calendar year/ })
    ).not.toHaveClass('h-11')
  })
})
