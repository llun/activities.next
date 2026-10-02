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

  it('keeps the orange on track when checked', () => {
    render(<Switch aria-label="Email" defaultChecked />)
    const track = screen.getByRole('switch', { name: 'Email' })
    expect(track).toHaveAttribute('data-state', 'checked')
    expect(track).toHaveClass('data-[state=checked]:bg-primary')
  })
})
