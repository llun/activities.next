/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

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

  it.each([
    { label: 'Anyone', policy: 'public' },
    { label: 'Followers', policy: 'followers' },
    { label: 'No one', policy: 'nobody' }
  ])(
    'invokes onQuotePolicyChange with $policy when picking "$label"',
    async ({ label, policy }) => {
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
        screen.getByRole('button', {
          name: /set visibility and who can quote/i
        }),
        { key: 'ArrowDown' }
      )

      // Scope to the "Who can quote" group so the quote-policy "Followers" is
      // not confused with the visibility "Followers" (both are menuitemradios
      // with the same accessible name).
      const quoteGroup = await screen.findByRole('group', {
        name: /who can quote/i
      })
      const option = within(quoteGroup).getByRole('menuitemradio', {
        name: new RegExp(`^${label}$`, 'i')
      })
      fireEvent.click(option)

      expect(onQuotePolicyChange).toHaveBeenCalledWith(policy)
    }
  )

  it('shows the quote-policy icon on the trigger only when the policy is not public', () => {
    const trigger = () =>
      screen.getByRole('button', {
        name: /set visibility and who can quote/i
      })

    const { rerender } = render(
      <VisibilitySelector
        visibility="public"
        onVisibilityChange={vi.fn()}
        quotePolicy="public"
        onQuotePolicyChange={vi.fn()}
      />
    )
    // Default "Anyone" (public): no quote-policy icon on the trigger.
    expect(trigger().querySelector('.lucide-ban')).toBeNull()

    rerender(
      <VisibilitySelector
        visibility="public"
        onVisibilityChange={vi.fn()}
        quotePolicy="nobody"
        onQuotePolicyChange={vi.fn()}
      />
    )
    // "No one" (nobody): the Ban glyph is added to the trigger.
    expect(trigger().querySelector('.lucide-ban')).not.toBeNull()
  })
})
