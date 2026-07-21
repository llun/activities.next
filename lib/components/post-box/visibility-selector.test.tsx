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

  it('surfaces the active quote policy in the trigger label', () => {
    render(
      <VisibilitySelector
        visibility="public"
        onVisibilityChange={vi.fn()}
        quotePolicy="followers"
        onQuotePolicyChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', {
        name: /set visibility and who can quote, current: public, followers can quote/i
      })
    ).toBeInTheDocument()
  })

  it('invokes onQuotePolicyChange with the picked policy', async () => {
    const onQuotePolicyChange = vi.fn()
    render(
      <VisibilitySelector
        visibility="public"
        onVisibilityChange={vi.fn()}
        quotePolicy="public"
        onQuotePolicyChange={onQuotePolicyChange}
      />
    )

    fireEvent.keyDown(
      screen.getByRole('button', { name: /set visibility and who can quote/i }),
      { key: 'ArrowDown' }
    )
    expect(await screen.findByText(/who can quote/i)).toBeInTheDocument()

    // "No one" is unique to the quote section, so it disambiguates from the
    // "Followers" label shared with the visibility list.
    const option = await screen.findByRole('menuitemradio', { name: /no one/i })
    fireEvent.click(option)

    expect(onQuotePolicyChange).toHaveBeenCalledWith('nobody')
  })
})
