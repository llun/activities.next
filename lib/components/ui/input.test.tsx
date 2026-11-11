/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Input } from './input'

describe('Input', () => {
  it('renders with data-slot="input", appearance-none, control height, and keycap styling', () => {
    render(<Input placeholder="Enter text" />)
    const input = screen.getByPlaceholderText('Enter text')
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveClass('appearance-none')
    expect(input).toHaveClass('w-full')
    expect(input).toHaveClass(
      'h-(--control-h)',
      'rounded-md',
      'border-input',
      'shadow-[inset_0_1px_0_hsl(0_0%_0%/0.04)]'
    )
    expect(input).toHaveClass('bg-background', 'dark:bg-input/30')
    expect(input).not.toHaveClass('bg-transparent')
    expect(input).not.toHaveClass('shadow-xs')
    expect(input).not.toHaveClass('h-9')
  })

  it('renders two-tone focus ring and forced-colors fallback', () => {
    render(<Input placeholder="Focus" />)
    const input = screen.getByPlaceholderText('Focus')
    expect(input).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
  })

  it('preserves appearance-none for date inputs to avoid iOS Safari box-sizing overflow', () => {
    render(<Input type="date" aria-label="Select date" />)
    const input = screen.getByLabelText('Select date')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveClass('appearance-none')
  })

  it('allows merging custom className', () => {
    render(<Input placeholder="Custom" className="text-center" />)
    const input = screen.getByPlaceholderText('Custom')
    expect(input).toHaveClass('appearance-none')
    expect(input).toHaveClass('text-center')
  })
  it('draws the invalid ring at rest, not only on focus', () => {
    render(<Input aria-label="Name" aria-invalid="true" />)
    const input = screen.getByLabelText('Name')
    // Colour and 3 px width both sit on aria-invalid, so the ring shows
    // without the focus-visible ring supplying its width.
    expect(input).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
      'dark:aria-invalid:ring-destructive/40',
      'aria-invalid:ring-[3px]'
    )
  })

  it('turns the focus ring destructive on an invalid field', () => {
    render(<Input aria-label="Name" aria-invalid="true" />)
    expect(screen.getByLabelText('Name')).toHaveClass(
      'aria-invalid:focus-visible:ring-0',
      'aria-invalid:focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--destructive-text)]'
    )
  })

  it('fills a disabled input in light and keeps the translucent fill in dark', () => {
    render(<Input aria-label="Handle" disabled />)
    const input = screen.getByLabelText('Handle')
    expect(input).toBeDisabled()
    expect(input).toHaveClass(
      'disabled:bg-muted',
      'dark:disabled:bg-input/30',
      'disabled:opacity-50'
    )
  })
})
