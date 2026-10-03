/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog'

const renderDialog = (className?: string) =>
  render(
    <Dialog open>
      <DialogContent className={className}>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
      </DialogContent>
    </Dialog>
  )

describe('DialogContent', () => {
  it('sits on the card surface in dark mode, with a 16 px radius and a 440 px default width', () => {
    renderDialog()
    const content = screen.getByRole('dialog')
    expect(content).toHaveClass(
      'bg-background',
      'dark:bg-card',
      'rounded-2xl',
      'sm:max-w-[440px]'
    )
    // One call per class: `.not.toHaveClass(a, b)` passes when EITHER is
    // absent, so a stale default left beside the new one would go unnoticed.
    expect(content).not.toHaveClass('rounded-lg')
    expect(content).not.toHaveClass('sm:max-w-lg')
  })

  it('lets a dialog that sets its own width keep it', () => {
    renderDialog('sm:max-w-lg')
    const content = screen.getByRole('dialog')
    expect(content).toHaveClass('sm:max-w-lg')
    expect(content).not.toHaveClass('sm:max-w-[440px]')
  })
})
