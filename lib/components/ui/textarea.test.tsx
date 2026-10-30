/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Textarea } from './textarea'

describe('Textarea', () => {
  it('draws the invalid ring at rest, not only on focus', () => {
    render(<Textarea aria-label="Summary" aria-invalid="true" />)
    expect(screen.getByLabelText('Summary')).toHaveClass(
      'aria-invalid:border-destructive',
      'aria-invalid:ring-destructive/20',
      'dark:aria-invalid:ring-destructive/40',
      'aria-invalid:ring-[3px]'
    )
  })
})
