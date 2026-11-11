/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Textarea } from './textarea'

describe('Textarea', () => {
  it('renders border-input, rounded-md, inset shadow, and two-tone focus ring', () => {
    render(<Textarea aria-label="Summary" />)
    const textarea = screen.getByLabelText('Summary')
    expect(textarea).toHaveAttribute('data-slot', 'textarea')
    expect(textarea).toHaveClass(
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
    expect(textarea).not.toHaveClass('shadow-xs')
  })

  it('draws the invalid ring at rest, not only on focus', () => {
    render(<Textarea aria-label="Summary" aria-invalid="true" />)
    expect(screen.getByLabelText('Summary')).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
      'dark:aria-invalid:ring-destructive/40',
      'aria-invalid:ring-[3px]'
    )
  })

  it('turns the focus ring destructive on an invalid field', () => {
    render(<Textarea aria-label="Summary" aria-invalid="true" />)
    expect(screen.getByLabelText('Summary')).toHaveClass(
      'aria-invalid:focus-visible:ring-0',
      'aria-invalid:focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--destructive-text)]'
    )
  })
})
