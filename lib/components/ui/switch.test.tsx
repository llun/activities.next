/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Switch } from './switch'

describe('Switch', () => {
  it('draws the off track in the design Control Off colour, not the input hairline', () => {
    render(<Switch aria-label="Email" />)
    const track = screen.getByRole('switch', { name: 'Email' })
    expect(track).toHaveClass('data-[state=unchecked]:bg-control-off')
    // The old fills: --input (#E5E5E5 light) and its 80 % dark variant.
    expect(track.className).not.toContain('bg-input')
  })

  it('draws track with rounded-md, border-input, no shadow, and two-tone focus ring', () => {
    render(<Switch aria-label="Email" />)
    const track = screen.getByRole('switch', { name: 'Email' })
    expect(track).toHaveClass(
      'rounded-md',
      'border-input',
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
    expect(track).not.toHaveClass('rounded-full')
    expect(track).not.toHaveClass('shadow-xs')
  })

  it('draws thumb with rounded-[1px]', () => {
    const { container } = render(<Switch aria-label="Email" />)
    const thumb = container.querySelector('[data-slot="switch-thumb"]')
    expect(thumb).toHaveClass('rounded-[1px]')
    expect(thumb).not.toHaveClass('rounded-full')
  })
})
