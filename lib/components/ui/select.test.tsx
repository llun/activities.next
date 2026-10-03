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

  it('keeps room for the chevron when a call site sets its own padding', () => {
    render(<Select aria-label="Duration" className="h-8 w-auto px-2" />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveClass('h-8', 'px-2', 'pr-8')
  })
})
