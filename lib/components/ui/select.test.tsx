/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Select } from './select'

describe('Select', () => {
  it('stays a native select with its own options', () => {
    render(
      <Select aria-label="Visibility" defaultValue="unlisted">
        <option value="public">Public</option>
        <option value="unlisted">Unlisted</option>
      </Select>
    )
    const select = screen.getByRole('combobox', { name: 'Visibility' })
    expect(select.tagName).toBe('SELECT')
    expect(select).toHaveAttribute('data-slot', 'select')
    expect(select).toHaveValue('unlisted')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('still reports changes through onChange', () => {
    const onChange = vi.fn()
    render(
      <Select aria-label="Visibility" onChange={onChange}>
        <option value="public">Public</option>
        <option value="private">Followers only</option>
      </Select>
    )
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'private' }
    })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('hides the OS arrow and paints the muted chevron instead', () => {
    render(<Select aria-label="Visibility" />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveClass('appearance-none', 'pr-8')
    const chevrons = Array.from(select.classList).filter((name) =>
      name.includes('bg-[url(data:image/svg+xml')
    )
    // One chevron per theme: --muted-foreground is #6E6E6E light, #A3A3A3 dark.
    expect(chevrons).toHaveLength(2)
    expect(chevrons.find((name) => name.startsWith('bg-['))).toContain(
      '%236E6E6E'
    )
    expect(chevrons.find((name) => name.startsWith('dark:bg-['))).toContain(
      '%23A3A3A3'
    )
  })

  it('renders control height, border-input, rounded-md, inset shadow, and two-tone focus ring', () => {
    render(<Select aria-label="Visibility" />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveClass(
      'h-(--control-h)',
      'border-input',
      'rounded-md',
      'shadow-[inset_0_1px_0_hsl(0_0%_0%/0.04)]',
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
    expect(select).not.toHaveClass('h-9')
    expect(select).not.toHaveClass('shadow-xs')
  })

  it('keeps room for the chevron when a call site sets its own padding', () => {
    render(<Select aria-label="Duration" className="h-8 w-auto px-2" />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveClass('h-8', 'px-2', 'pr-8')
  })
})
