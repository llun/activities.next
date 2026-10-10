/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { VisibilitySelector } from './visibility-selector'

describe('VisibilitySelector', () => {
  it('shows the current visibility label on the trigger', () => {
    render(
      <VisibilitySelector visibility="unlisted" onVisibilityChange={vi.fn()} />
    )
    expect(
      screen.getByRole('button', {
        name: /set visibility, current: unlisted/i
      })
    ).toBeInTheDocument()
  })

  it('invokes onVisibilityChange with the picked visibility', async () => {
    const onVisibilityChange = vi.fn()
    render(
      <VisibilitySelector
        visibility="public"
        onVisibilityChange={onVisibilityChange}
      />
    )

    // Radix dropdowns open from the keyboard in jsdom (matching the pattern
    // used by the post-menu / section-nav dropdown tests).
    fireEvent.keyDown(screen.getByRole('button', { name: /set visibility/i }), {
      key: 'ArrowDown'
    })
    const option = await screen.findByRole('menuitemradio', { name: /direct/i })
    fireEvent.click(option)

    expect(onVisibilityChange).toHaveBeenCalledWith('direct')
  })

  it('omits the who-can-quote section when no quote props are provided', async () => {
    render(
      <VisibilitySelector visibility="public" onVisibilityChange={vi.fn()} />
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /set visibility/i }), {
      key: 'ArrowDown'
    })
    await screen.findByRole('menuitemradio', { name: /^public/i })

    expect(screen.queryByText(/who can quote/i)).not.toBeInTheDocument()
  })

  it('marks the current visibility row as checked', async () => {
    render(
      <VisibilitySelector visibility="unlisted" onVisibilityChange={vi.fn()} />
    )

    fireEvent.keyDown(screen.getByRole('button', { name: /set visibility/i }), {
      key: 'ArrowDown'
    })

    expect(
      await screen.findByRole('menuitemradio', { name: /^unlisted/i })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('menuitemradio', { name: /^public/i })
    ).toHaveAttribute('aria-checked', 'false')
  })
})
