/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ComponentProps } from 'react'

import { PostOptionsMenu } from './post-options-menu'

const baseProps: ComponentProps<typeof PostOptionsMenu> = {
  showFitnessFile: true,
  onChooseFitnessFile: vi.fn(),
  pollShowing: false,
  quoting: false,
  onTogglePoll: vi.fn(),
  visibility: 'public',
  onVisibilityChange: vi.fn(),
  quotePolicy: 'public',
  onQuotePolicyChange: vi.fn(),
  contentWarningVisible: false,
  onToggleContentWarning: vi.fn(),
  previewShowing: false,
  onTogglePreview: vi.fn()
}

const renderMenu = (props: Partial<ComponentProps<typeof PostOptionsMenu>>) =>
  render(<PostOptionsMenu {...baseProps} {...props} />)

const trigger = () => screen.getByRole('button', { name: 'Post options' })

// Radix dropdowns open from the keyboard in jsdom.
const openMenu = async () => {
  fireEvent.keyDown(trigger(), { key: 'ArrowDown' })
  return screen.findByRole('menu')
}

describe('PostOptionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists fitness file, poll, visibility, content warning and preview in order', async () => {
    renderMenu({})
    const menu = await openMenu()

    const items = Array.from(menu.querySelectorAll('[role^="menuitem"]'))
    expect(items.map((item) => item.textContent)).toEqual([
      'Fitness file',
      'Poll',
      'Visibility Public',
      'Content warning',
      'Preview'
    ])
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
  })

  it('omits the fitness file item when it is not offered (reply or edit)', async () => {
    renderMenu({ showFitnessFile: false })
    const menu = await openMenu()

    expect(
      within(menu).queryByRole('menuitem', { name: 'Fitness file' })
    ).not.toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Poll' })
    ).toBeInTheDocument()
  })

  it('chooses a fitness file and closes the menu', async () => {
    const onChooseFitnessFile = vi.fn()
    renderMenu({ onChooseFitnessFile })
    await openMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Fitness file' }))

    expect(onChooseFitnessFile).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('disables the fitness file, poll, visibility and content warning items while posting', async () => {
    renderMenu({ disabled: true })
    const menu = await openMenu()

    expect(
      within(menu).getByRole('menuitem', { name: 'Fitness file' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Poll' })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(menu).getByRole('menuitem', { name: /^Visibility/ })
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Content warning' })
    ).toHaveAttribute('aria-disabled', 'true')
    // Previewing changes nothing that is posted, so it stays available.
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Preview' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('toggles the poll and closes the menu', async () => {
    const onTogglePoll = vi.fn()
    renderMenu({ onTogglePoll })
    await openMenu()

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Poll' }))

    expect(onTogglePoll).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows the poll as checked while the poll is on', async () => {
    renderMenu({ pollShowing: true })
    await openMenu()

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Poll' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('disables the poll with an explanation while quoting', async () => {
    const onTogglePoll = vi.fn()
    renderMenu({ quoting: true, onTogglePoll })
    await openMenu()

    // The name stays "Poll"; the explanation is its description.
    const poll = screen.getByRole('menuitemcheckbox', { name: 'Poll' })
    expect(poll).toHaveAttribute('aria-disabled', 'true')
    expect(poll).toHaveAccessibleDescription(
      'A quote post cannot include a poll'
    )

    fireEvent.click(poll)
    expect(onTogglePoll).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'Content warning',
      prop: 'contentWarningVisible',
      handler: 'onToggleContentWarning'
    },
    { name: 'Preview', prop: 'previewShowing', handler: 'onTogglePreview' }
  ] as const)(
    'toggles $name without closing the menu and reflects its state',
    async ({ name, prop, handler }) => {
      const onToggle = vi.fn()
      const { rerender } = renderMenu({ [handler]: onToggle })
      await openMenu()

      const item = screen.getByRole('menuitemcheckbox', { name })
      expect(item).toHaveAttribute('aria-checked', 'false')

      fireEvent.click(item)

      expect(onToggle).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('menu')).toBeInTheDocument()

      rerender(
        <PostOptionsMenu
          {...baseProps}
          {...{ [handler]: onToggle, [prop]: true }}
        />
      )
      expect(screen.getByRole('menuitemcheckbox', { name })).toHaveAttribute(
        'aria-checked',
        'true'
      )
    }
  )

  it('does not nest an interactive control inside the toggle rows', async () => {
    renderMenu({ contentWarningVisible: true, previewShowing: true })
    await openMenu()

    for (const name of ['Content warning', 'Preview']) {
      const item = screen.getByRole('menuitemcheckbox', { name })
      expect(within(item).queryByRole('switch')).not.toBeInTheDocument()
      expect(within(item).queryByRole('button')).not.toBeInTheDocument()
    }
  })

  it('shows the current visibility on its row', async () => {
    renderMenu({ visibility: 'unlisted' })
    await openMenu()

    expect(
      screen.getByRole('menuitem', { name: /^Visibility/ })
    ).toHaveTextContent('Unlisted')
  })

  it.each([
    { quotePolicy: 'public', words: null, icon: null },
    { quotePolicy: 'followers', words: 'Followers can quote', icon: 'users' },
    { quotePolicy: 'nobody', words: 'No one can quote', icon: 'ban' }
  ] as const)(
    'shows the visibility, plus the quote policy icon only when restricted ($quotePolicy)',
    async ({ quotePolicy, words, icon }) => {
      renderMenu({ quotePolicy })
      await openMenu()

      const row = screen.getByRole('menuitem', { name: /^Visibility/ })
      expect(row).toHaveTextContent(/^Visibility Public/)
      if (!words || !icon) {
        expect(row).not.toHaveTextContent(/can quote/)
        expect(row.querySelector('svg.lucide-users, svg.lucide-ban')).toBeNull()
        return
      }
      expect(row).toHaveTextContent(words)
      expect(row.querySelector(`svg.lucide-${icon}`)).not.toBeNull()
      // The words are for assistive technology only; the icon is the visual.
      expect(row.querySelector('.sr-only')).toHaveTextContent(words)
    }
  )

  it('marks the current quote policy row as checked in the submenu', async () => {
    renderMenu({ quotePolicy: 'followers' })
    await openMenu()

    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
      key: 'ArrowRight'
    })
    const quoteGroup = await screen.findByRole('group', {
      name: /who can quote/i
    })

    expect(
      within(quoteGroup).getByRole('menuitemradio', { name: /^Followers$/i })
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('changes the visibility from the Visibility submenu', async () => {
    const onVisibilityChange = vi.fn()
    renderMenu({ onVisibilityChange })
    await openMenu()

    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
      key: 'ArrowRight'
    })
    const direct = await screen.findByRole('menuitemradio', { name: /direct/i })
    expect(
      screen.getByRole('menuitemradio', { name: /^public/i })
    ).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(direct)

    expect(onVisibilityChange).toHaveBeenCalledWith('direct')
  })

  it.each([
    { label: /^anyone$/i, policy: 'public' },
    { label: /^followers$/i, policy: 'followers' },
    { label: /^no one$/i, policy: 'nobody' }
  ] as const)(
    'changes who can quote to $policy from the Visibility submenu',
    async ({ label, policy }) => {
      const onQuotePolicyChange = vi.fn()
      // Start from a different policy so the picked row is a real change.
      renderMenu({
        onQuotePolicyChange,
        quotePolicy: policy === 'followers' ? 'nobody' : 'followers'
      })
      await openMenu()

      fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
        key: 'ArrowRight'
      })
      const quoteGroup = await screen.findByRole('group', {
        name: /who can quote/i
      })
      fireEvent.click(
        within(quoteGroup).getByRole('menuitemradio', { name: label })
      )

      expect(onQuotePolicyChange).toHaveBeenCalledWith(policy)
    }
  )

  describe('active state of the Post options button', () => {
    it('is not tinted while every option is off', () => {
      renderMenu({})
      expect(trigger()).not.toHaveAttribute('data-active')
      expect(trigger()).not.toHaveClass('bg-primary/10')
    })

    it.each([
      { prop: 'contentWarningVisible' },
      { prop: 'previewShowing' },
      { prop: 'pollShowing' }
    ] as const)('is tinted while $prop is on', ({ prop }) => {
      renderMenu({ [prop]: true })
      expect(trigger()).toHaveAttribute('data-active', 'true')
      expect(trigger()).toHaveClass('bg-primary/10', 'text-primary')
    })

    it('is not tinted by a non-default visibility alone', () => {
      renderMenu({ visibility: 'direct' })
      expect(trigger()).not.toHaveAttribute('data-active')
    })
  })
})
