/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FC } from 'react'

import { ReactionButton } from '@/lib/components/posts/actions/reaction-button'
import { ReactionRow } from '@/lib/components/posts/reaction-row'
import { useReactionState } from '@/lib/components/posts/useReactionState'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'

const mockReactToStatus = vi.fn()
const mockUnreactFromStatus = vi.fn()

vi.mock('@/lib/client', () => ({
  reactToStatus: (...params: unknown[]) => mockReactToStatus(...params),
  unreactFromStatus: (...params: unknown[]) => mockUnreactFromStatus(...params),
  getCustomEmojis: () => Promise.resolve([])
}))

const currentActor = {
  id: 'https://llun.test/users/me',
  username: 'me'
} as ActorProfile

const statusWith = (reactions: StatusReaction[]) =>
  ({
    id: 'https://llun.test/users/author/statuses/1',
    type: 'Note',
    actorId: 'https://llun.test/users/author',
    reactions
  }) as unknown as StatusNote

const fire: StatusReaction = {
  name: '🔥',
  count: 2,
  me: false,
  url: null,
  static_url: null
}

interface HarnessProps {
  currentActor?: ActorProfile
  status?: StatusNote
  hideTrigger?: boolean
}

// The button shares one `ReactionState` with the chip row, exactly as `Actions`
// and `Post` wire them.
const Reactions: FC<HarnessProps> = ({ hideTrigger, status, ...params }) => {
  const state = useReactionState({
    ...params,
    status: status ?? statusWith([])
  })
  return (
    <>
      <ReactionRow state={state} />
      <ReactionButton state={state} hideTrigger={hideTrigger} />
    </>
  )
}

// The button on its own, for the cases that care about what it contributes to
// the action row's layout rather than about the chips.
const ReactionButtonOnly: FC<HarnessProps> = ({ hideTrigger, ...params }) => {
  const state = useReactionState({ ...params, status: statusWith([]) })
  return <ReactionButton state={state} hideTrigger={hideTrigger} />
}

const trigger = () => screen.getByRole('button', { name: /^Add reaction/ })

describe('ReactionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the running total so the count is not glyph-only', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([fire, { ...fire, name: '🎉', count: 1 }])}
      />
    )

    // The row shows a bare "3" beside the smiley; the label is what tells a
    // screen-reader user what that number counts.
    expect(
      screen.getByRole('button', { name: 'Add reaction, 3 reactions' })
    ).toHaveTextContent('3')
  })

  it.each([
    {
      description: 'no reactions yet',
      reactions: [],
      expected: '',
      label: 'Add reaction'
    },
    {
      description: 'a single reaction',
      reactions: [{ ...fire, count: 1 }],
      expected: '1',
      // Singular: the label is assembled, so "1 reactions" is one template
      // string away and nothing else would catch it.
      label: 'Add reaction, 1 reaction'
    },
    {
      description: 'a total past the chip cap',
      reactions: [{ ...fire, count: 120 }],
      expected: '99+',
      label: 'Add reaction, 120 reactions'
    }
  ])('shows $description as $expected', ({ reactions, expected, label }) => {
    render(
      <Reactions currentActor={currentActor} status={statusWith(reactions)} />
    )

    expect(trigger()).toHaveTextContent(expected)
    expect(trigger()).toHaveAccessibleName(label)
  })

  it('opens the picker and reacts with the chosen emoji', async () => {
    mockReactToStatus.mockResolvedValue({
      ok: true,
      reactions: [{ ...fire, count: 1, me: true }]
    })

    render(<Reactions currentActor={currentActor} status={statusWith([])} />)
    fireEvent.click(trigger())

    const picker = await screen.findByRole('dialog', {
      name: 'Choose a reaction'
    })
    expect(picker).toBeInTheDocument()

    const firstEmoji = screen
      .getAllByRole('button')
      .find((button) =>
        button.getAttribute('aria-label')?.startsWith('React with')
      )
    expect(firstEmoji).toBeDefined()
    fireEvent.click(firstEmoji as HTMLElement)

    await waitFor(() => expect(mockReactToStatus).toHaveBeenCalledTimes(1))
  })

  it('adds rather than removes when the picker returns an existing reaction', async () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([{ ...fire, me: true }])}
      />
    )
    fireEvent.click(trigger())
    await screen.findByRole('dialog', { name: 'Choose a reaction' })

    // 🔥 is not in the default tab, so search for it — the same way a user
    // reaching for a specific emoji would.
    fireEvent.change(screen.getByLabelText('Search emoji'), {
      target: { value: 'fire' }
    })
    const alreadyReacted = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.getAttribute('aria-label')?.startsWith('React with') &&
          button.textContent === '🔥'
      )
    expect(alreadyReacted).toBeDefined()
    fireEvent.click(alreadyReacted as HTMLElement)

    // "React with 🔥" must never undo a 🔥 the viewer already added.
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Choose a reaction' })
      ).not.toBeInTheDocument()
    )
    expect(mockUnreactFromStatus).not.toHaveBeenCalled()
    expect(mockReactToStatus).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Remove 🔥 reaction, 2')).toBeInTheDocument()
  })

  it('keeps focus on the trigger across a picker-driven reaction', async () => {
    let resolveRequest: (value: unknown) => void = () => {}
    mockReactToStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    render(<Reactions currentActor={currentActor} status={statusWith([])} />)
    fireEvent.click(trigger())
    await screen.findByRole('dialog', { name: 'Choose a reaction' })

    const firstEmoji = screen
      .getAllByRole('button')
      .find((button) =>
        button.getAttribute('aria-label')?.startsWith('React with')
      )
    fireEvent.click(firstEmoji as HTMLElement)

    // The trigger is focused by onPick and must STAY focused while the write is
    // in flight — disabling it here would blur it and reset the user's tab
    // position to the top of the document.
    await waitFor(() => expect(trigger()).toHaveFocus())
    resolveRequest({ ok: true, reactions: [{ ...fire, count: 1, me: true }] })
    await waitFor(() => expect(mockReactToStatus).toHaveBeenCalledTimes(1))
    expect(trigger()).toHaveFocus()
  })

  it('returns focus to the trigger when the picker closes', async () => {
    render(<Reactions currentActor={currentActor} status={statusWith([])} />)
    fireEvent.click(trigger())

    await screen.findByRole('dialog', { name: 'Choose a reaction' })
    fireEvent.keyDown(window, { key: 'Escape' })

    // Otherwise a keyboard user's focus is dumped on <body>.
    await waitFor(() => expect(trigger()).toHaveFocus())
  })

  it('lays nothing out in the row once it has handed the trigger to the menu', () => {
    render(
      <div data-testid="action-row">
        <ReactionButtonOnly currentActor={currentActor} hideTrigger />
      </div>
    )

    // A compact row moves the trigger into the ⋯ menu — but the component stays
    // mounted, because it is what that menu item opens. It must not leave an
    // empty wrapper behind: the row is a `gap-1` flex, so even a zero-width
    // element claims a gap of its own and shifts every action after it.
    expect(
      screen.queryByRole('button', { name: /^Add reaction/ })
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('action-row')).toBeEmptyDOMElement()
  })

  it('renders the picker outside the post so no ancestor can clip it', async () => {
    const { container } = render(
      <div style={{ overflow: 'hidden' }}>
        <Reactions currentActor={currentActor} status={statusWith([])} />
      </div>
    )
    fireEvent.click(trigger())

    const picker = await screen.findByRole('dialog', {
      name: 'Choose a reaction'
    })

    // Every card that wraps posts clips its children for rounded corners, and
    // the panel is far taller than the space inside them. Portalling it to the
    // document root is what stops that, so pin it: an `absolute` child of the
    // chip row was clipped on four separate surfaces before this.
    expect(container.contains(picker)).toBe(false)
    expect(document.body.contains(picker)).toBe(true)
    // Viewport-positioned, not positioned against an ancestor in the post.
    expect(picker.className).toContain('fixed')
  })

  it.each([
    {
      description: 'below the trigger when there is room',
      viewport: { width: 1280, height: 720 },
      anchor: { top: 100, bottom: 128, left: 400 },
      expected: { top: '136px', left: '400px' }
    },
    {
      description: 'pinned to the margin on a viewport narrower than the panel',
      viewport: { width: 280, height: 720 },
      anchor: { top: 100, bottom: 128, left: 200 },
      // Clamping the right edge before the left would yield a negative offset
      // here (280 - 288 - 8), pushing the panel off-screen.
      expected: { top: '136px', left: '8px' }
    },
    {
      description: 'clamped left when the trigger sits near the right edge',
      viewport: { width: 1280, height: 720 },
      anchor: { top: 100, bottom: 128, left: 1200 },
      expected: { top: '136px', left: '984px' }
    }
  ])(
    'positions the picker $description',
    async ({ viewport, anchor, expected }) => {
      const originalWidth = window.innerWidth
      const originalHeight = window.innerHeight
      Object.defineProperty(window, 'innerWidth', {
        value: viewport.width,
        configurable: true
      })
      Object.defineProperty(window, 'innerHeight', {
        value: viewport.height,
        configurable: true
      })

      render(<Reactions currentActor={currentActor} status={statusWith([])} />)
      const anchorButton = trigger()
      anchorButton.getBoundingClientRect = () =>
        ({
          ...anchor,
          right: anchor.left + 28,
          width: 28,
          height: 28
        }) as DOMRect

      fireEvent.click(anchorButton)
      const picker = await screen.findByRole('dialog', {
        name: 'Choose a reaction'
      })

      expect(picker.style.top).toBe(expected.top)
      expect(picker.style.left).toBe(expected.left)

      Object.defineProperty(window, 'innerWidth', {
        value: originalWidth,
        configurable: true
      })
      Object.defineProperty(window, 'innerHeight', {
        value: originalHeight,
        configurable: true
      })
    }
  )
})
