/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

import { Button, buttonVariants } from './button'

describe('Button', () => {
  it('renders a default button with rounded-md', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'default')
    expect(button).toHaveAttribute('data-size', 'default')
    expect(button).toHaveClass('rounded-md')
  })

  it('renders a pill variant button with rounded-full', () => {
    render(<Button variant="pill">Pill button</Button>)
    const button = screen.getByRole('button', { name: 'Pill button' })
    expect(button).toHaveAttribute('data-variant', 'pill')
    expect(button).toHaveClass('rounded-full')
    expect(button).not.toHaveClass('rounded-md')
  })

  it('preserves rounded-full when combined with sm size', () => {
    render(
      <Button variant="pill" size="sm">
        Small pill
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Small pill' })
    expect(button).toHaveAttribute('data-size', 'sm')
    expect(button).toHaveClass('rounded-full')
    expect(button).not.toHaveClass('rounded-md')
  })

  it('preserves rounded-full when combined with lg size', () => {
    render(
      <Button variant="pill" size="lg">
        Large pill
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Large pill' })
    expect(button).toHaveAttribute('data-size', 'lg')
    expect(button).toHaveClass('rounded-full')
    expect(button).not.toHaveClass('rounded-md')
  })

  it('renders outline variant with rounded-md', () => {
    render(<Button variant="outline">Outline</Button>)
    const button = screen.getByRole('button', { name: 'Outline' })
    expect(button).toHaveAttribute('data-variant', 'outline')
    expect(button).toHaveClass('rounded-md')
  })
})

describe('buttonVariants', () => {
  it('generates rounded-full class for pill variant after merging', () => {
    const classes = cn(buttonVariants({ variant: 'pill' }))
    expect(classes).toContain('rounded-full')
    expect(classes).not.toContain('rounded-md')
  })
})
