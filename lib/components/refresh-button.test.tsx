/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { RefreshButton } from './refresh-button'

describe('RefreshButton', () => {
  it('reloads on click under its accessible name', () => {
    const onRefresh = vi.fn()
    render(
      <RefreshButton onRefresh={onRefresh} accessibleName="Refresh timeline" />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Refresh timeline' }))

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('spins and ignores clicks while refreshing, keeping focus', () => {
    const onRefresh = vi.fn()
    render(
      <RefreshButton
        onRefresh={onRefresh}
        refreshing
        accessibleName="Refresh fitness overview"
      />
    )

    const button = screen.getByRole('button', {
      name: 'Refresh fitness overview'
    })
    // aria-disabled, not disabled: the pressed control keeps keyboard focus.
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    button.focus()
    expect(button.querySelector('svg')).toHaveClass('animate-spin')
    fireEvent.click(button)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })

  it('merges a size class for rows with taller controls', () => {
    render(
      <RefreshButton
        onRefresh={vi.fn()}
        accessibleName="Refresh"
        className="size-11"
      />
    )

    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass(
      'size-11'
    )
  })
})
