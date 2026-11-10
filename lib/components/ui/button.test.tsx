/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from './button'

describe('Button', () => {
  it('renders a default button with rounded-md and control height', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'default')
    expect(button).toHaveAttribute('data-size', 'default')
    expect(button).toHaveClass(
      'rounded-md',
      'h-(--control-h)',
      'border-primary-edge',
      'shadow-[shadow:inset_0_calc(var(--edge-w,2px)*-1)_0_var(--primary-edge)]'
    )
  })

  it('renders two-tone focus ring and forced-colors fallback', () => {
    render(<Button>Focus</Button>)
    const button = screen.getByRole('button', { name: 'Focus' })
    expect(button).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
  })

  it('renders a pill variant button with rounded-md and keycap styling', () => {
    render(<Button variant="pill">Pill button</Button>)
    const button = screen.getByRole('button', { name: 'Pill button' })
    expect(button).toHaveAttribute('data-variant', 'pill')
    expect(button).toHaveClass(
      'rounded-md',
      'bg-card',
      'border-input',
      'shadow-[shadow:inset_0_calc(var(--edge-w,2px)*-1)_0_var(--control-edge)]'
    )
    expect(button).not.toHaveClass('rounded-full')
  })

  it('preserves rounded-md when combined with lg size', () => {
    render(
      <Button variant="pill" size="lg">
        Large pill
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Large pill' })
    expect(button).toHaveAttribute('data-size', 'lg')
    expect(button).toHaveClass('rounded-md', 'h-10')
    expect(button).not.toHaveClass('rounded-full')
  })

  it('renders the link variant in the orange TEXT colour, not the icon orange', () => {
    render(<Button variant="link">Link</Button>)
    const button = screen.getByRole('button', { name: 'Link' })
    expect(button).toHaveClass('text-primary-text')
    expect(button).not.toHaveClass('text-primary')
  })

  it('fills outline button with card surface in both themes and keycap edge', () => {
    render(<Button variant="outline">Outline</Button>)
    const button = screen.getByRole('button', { name: 'Outline' })
    expect(button).toHaveClass(
      'bg-card',
      'border-input',
      'shadow-[shadow:inset_0_calc(var(--edge-w,2px)*-1)_0_var(--control-edge)]'
    )
    expect(button).not.toHaveClass('dark:bg-input/30')
    expect(button).not.toHaveClass('bg-background')
    expect(button).not.toHaveClass('shadow-xs')
  })

  it('renders destructive variant with destructive keycap edges', () => {
    render(<Button variant="destructive">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass(
      'border-destructive-edge',
      'shadow-[shadow:inset_0_calc(var(--edge-w,2px)*-1)_0_var(--destructive-edge)]'
    )
  })

  it.each([
    ['default', 'primary-edge'],
    ['destructive', 'destructive-edge'],
    ['outline', 'control-edge'],
    ['secondary', 'control-edge'],
    ['pill', 'control-edge']
  ] as const)(
    'presses the %s variant down 1px, its %s edge shrinking to 1px',
    (variant, edge) => {
      render(<Button variant={variant}>Action</Button>)
      const button = screen.getByRole('button', { name: 'Action' })
      expect(button).toHaveClass(
        `shadow-[shadow:inset_0_calc(var(--edge-w,2px)*-1)_0_var(--${edge})]`,
        'active:not-disabled:not-aria-disabled:translate-y-px',
        'active:not-disabled:not-aria-disabled:[--edge-w:1px]'
      )
    }
  )

  // Pressing changes --edge-w, not the shadow, so a call site's own shadow is
  // never swapped out while the button is held down.
  it.each(['shadow-none', 'shadow-[0_2px_4px_black]'])(
    'lets a call-site %s replace the keycap edge',
    (shadow) => {
      render(<Button className={shadow}>Action</Button>)
      const button = screen.getByRole('button', { name: 'Action' })
      expect(button).toHaveClass(shadow)
      expect(button.className).not.toMatch(/edge-w,2px/)
    }
  )

  it('keeps the keycap edge under a call-site shadow colour', () => {
    render(<Button className="shadow-black/20">Action</Button>)
    expect(screen.getByRole('button', { name: 'Action' }).className).toMatch(
      /shadow-\[shadow:inset_0_calc\(var\(--edge-w,2px\)\*-1\)_0_var\(--primary-edge\)\]/
    )
  })

  it('keeps a call-site shadow while pressed', () => {
    render(
      <Button variant="pill" className="shadow-lg">
        Action
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Action' })
    expect(button).toHaveClass('shadow-lg')
    expect(button.className).not.toMatch(/active:\S*shadow/)
  })

  it.each([['ghost'], ['link']] as const)(
    'does not add keycap pressed state on %s variant',
    (variant) => {
      render(<Button variant={variant}>Action</Button>)
      const button = screen.getByRole('button', { name: 'Action' })
      expect(button).not.toHaveClass(
        'active:not-disabled:not-aria-disabled:translate-y-px'
      )
    }
  )
})
