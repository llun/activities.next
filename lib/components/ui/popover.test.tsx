/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Popover, PopoverContent, PopoverTrigger } from './popover'

describe('Popover', () => {
  beforeEach(() => {
    // Radix Popper observes its content's size; jsdom has no ResizeObserver.
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function () {
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn()
        }
      })
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('opens from its trigger and closes on Escape', () => {
    render(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Panel body</PopoverContent>
      </Popover>
    )
    expect(screen.queryByText('Panel body')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByText('Panel body')).toBeInTheDocument()
    expect(screen.getByText('Panel body')).toHaveAttribute(
      'data-slot',
      'popover-content'
    )

    fireEvent.keyDown(screen.getByText('Panel body'), { key: 'Escape' })
    expect(screen.queryByText('Panel body')).not.toBeInTheDocument()
  })

  it('renders content that is open on mount', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent className="w-auto">Always open</PopoverContent>
      </Popover>
    )
    expect(screen.getByText('Always open')).toHaveClass('w-auto')
  })
})
