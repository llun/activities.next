/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FC } from 'react'

import { ReactionButton } from '@/lib/components/posts/actions/reaction-button'
import { ReactionRow } from '@/lib/components/posts/reaction-row'
import {
  ReactionState,
  useReactionState
} from '@/lib/components/posts/useReactionState'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
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
  status: StatusNote
  onReactionsChanged?: (
    status: StatusNote | StatusPoll,
    reactions: StatusReaction[]
  ) => void
}

// The chips and the action-row trigger are two halves of one control sharing a
// single `ReactionState`, so the tests wire them up the way `Post` does.
const Reactions: FC<HarnessProps> = (props) => {
  const state = useReactionState(props)
  return (
    <>
      <ReactionRow state={state} />
      <ReactionButton state={state} />
    </>
  )
}

const trigger = () => screen.getByRole('button', { name: /^Add reaction/ })

// A settled `ReactionState` for the cases that render the chips on their own —
// a logged-out surface has no action row, so there is no trigger to share with.
const readOnlyReactionState = (
  status: StatusNote,
  canReact = false
): ReactionState => {
  const reactions = status.reactions ?? []
  return {
    canReact,
    reactions,
    total: reactions.reduce((sum, reaction) => sum + reaction.count, 0),
    mine: reactions.some((reaction) => reaction.me),
    pendingName: null,
    error: null,
    isPicking: false,
    setIsPicking: vi.fn(),
    triggerRef: { current: null },
    focusTrigger: vi.fn(),
    toggle: vi.fn()
  }
}

describe('ReactionRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a chip per reaction with its count', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([fire, { ...fire, name: '🎉', count: 1 }])}
      />
    )

    expect(screen.getByLabelText('Add 🔥 reaction, 2')).toHaveTextContent('2')
    expect(screen.getByLabelText('Add 🎉 reaction, 1')).toHaveTextContent('1')
  })

  it('marks the viewer own reaction as pressed', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([{ ...fire, me: true }])}
      />
    )

    expect(screen.getByLabelText('Remove 🔥 reaction, 2')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('adds a reaction optimistically and reconciles with the server', async () => {
    // Deliberately NOT the optimistic guess (which would be count 3, me true,
    // url null): a serve-shaped value proves setReactions used the response and
    // not its own prediction.
    const served: StatusReaction[] = [
      { ...fire, count: 7, me: true },
      {
        name: 'partyparrot',
        count: 1,
        me: false,
        url: 'https://llun.test/e.gif',
        static_url: 'https://llun.test/e.png'
      }
    ]
    mockReactToStatus.mockResolvedValue({ ok: true, reactions: served })
    const onReactionsChanged = vi.fn()
    const status = statusWith([fire])

    render(
      <Reactions
        currentActor={currentActor}
        status={status}
        onReactionsChanged={onReactionsChanged}
      />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

    // Optimistic flip happens before the request resolves: the guess is +1.
    expect(screen.getByLabelText('Remove 🔥 reaction, 3')).toHaveTextContent(
      '3'
    )
    await waitFor(() =>
      expect(mockReactToStatus).toHaveBeenCalledWith({
        statusId: status.id,
        name: '🔥'
      })
    )
    await waitFor(() =>
      expect(onReactionsChanged).toHaveBeenCalledWith(status, served)
    )
    // Reconciled to the server's rollups, not the optimistic guess.
    expect(screen.getByLabelText('Remove 🔥 reaction, 7')).toHaveTextContent(
      '7'
    )
    expect(screen.getByAltText('partyparrot')).toBeInTheDocument()
  })

  it('removes the viewer own reaction', async () => {
    mockUnreactFromStatus.mockResolvedValue({
      ok: true,
      reactions: [{ ...fire, count: 1, me: false }]
    })

    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([{ ...fire, count: 2, me: true }])}
      />
    )
    fireEvent.click(screen.getByLabelText('Remove 🔥 reaction, 2'))

    await waitFor(() => expect(mockUnreactFromStatus).toHaveBeenCalledTimes(1))
    expect(mockReactToStatus).not.toHaveBeenCalled()
  })

  it('reverts the chip and shows an error when the request fails', async () => {
    mockReactToStatus.mockResolvedValue({ ok: false })

    render(
      <Reactions currentActor={currentActor} status={statusWith([fire])} />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

    await waitFor(() =>
      expect(screen.getByTestId('reaction-error')).toBeInTheDocument()
    )
    // Reverted: back to the un-pressed chip with its original count.
    expect(screen.getByLabelText('Add 🔥 reaction, 2')).toHaveTextContent('2')
  })

  it('shows the server message instead of a retry prompt when it refuses', async () => {
    mockReactToStatus.mockResolvedValue({
      ok: false,
      error: 'You can only add 8 reactions to a post.'
    })

    render(
      <Reactions currentActor={currentActor} status={statusWith([fire])} />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

    await waitFor(() =>
      expect(screen.getByTestId('reaction-error')).toHaveTextContent(
        'You can only add 8 reactions to a post.'
      )
    )
  })

  it('renders a custom emoji as an image and a unicode one as text', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([
          fire,
          {
            name: 'partyparrot',
            count: 1,
            me: false,
            url: 'https://llun.test/emojis/partyparrot.gif',
            static_url: 'https://llun.test/emojis/partyparrot.png'
          }
        ])}
      />
    )

    expect(screen.getByAltText('partyparrot')).toHaveAttribute(
      'src',
      'https://llun.test/emojis/partyparrot.gif'
    )
    expect(screen.getByLabelText('Add 🔥 reaction, 2')).toHaveTextContent('🔥')
  })

  it('renders read-only chips for a logged-out reader without any control', () => {
    render(<ReactionRow state={readOnlyReactionState(statusWith([fire]))} />)

    // Readable, but not a control: a disabled button would drop the count out
    // of the tab order and grey it out for everyone who cannot react.
    // Exposed as an image with the emoji in its label: the glyph is aria-hidden,
    // so the label is the only thing that names which reaction this count is for.
    const chip = screen.getByRole('img', { name: '🔥 reaction, 2' })
    expect(chip).toHaveTextContent('2')
    expect(chip.tagName).toBe('SPAN')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing on a post with no reactions', () => {
    // The picker trigger lives in the action row now, so an unreacted post must
    // not leave an empty chip row (and its top margin) behind.
    const { container } = render(
      <ReactionRow state={readOnlyReactionState(statusWith([]), true)} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('never truncates away the viewer own reaction', () => {
    // 12 older reactions fill the row; the viewer's own is the 13th and, being
    // newest, sorts last in the rollups.
    const crowd: StatusReaction[] = Array.from({ length: 12 }, (_, index) => ({
      name: `e${index}`,
      count: 1,
      me: false,
      url: `https://llun.test/e${index}.gif`,
      static_url: `https://llun.test/e${index}.png`
    }))

    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([...crowd, { ...fire, count: 1, me: true }])}
      />
    )

    // Visible, and one of the older chips gives up its slot instead.
    expect(screen.getByLabelText('Remove 🔥 reaction, 1')).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Add e11 reaction, 1')
    ).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
  })

  it('shows a remote custom emoji reaction without offering to join it', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([
          {
            name: 'partyparrot@remote.example',
            count: 3,
            me: false,
            // A resolvable url — the chip is still not joinable, because the
            // name is namespaced to another instance.
            url: 'https://remote.example/e.gif',
            static_url: 'https://remote.example/e.png'
          }
        ])}
      />
    )

    // The write path only accepts a unicode emoji or one of this instance's own
    // shortcodes, so a button here would 422 on every click.
    const chip = screen.getByRole('img', {
      name: 'partyparrot@remote.example reaction, 3'
    })
    expect(chip.tagName).toBe('SPAN')
    expect(
      screen.getByAltText('partyparrot@remote.example')
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Add partyparrot@remote\.example reaction/)
    ).not.toBeInTheDocument()
  })

  it('shows a disabled local custom emoji read-only', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([
          // No url: the rollup resolves urls only for enabled local emoji, so a
          // shortcode with none is one this instance can no longer react with.
          { name: 'retired', count: 4, me: false, url: null, static_url: null }
        ])}
      />
    )

    expect(
      screen.getByRole('img', { name: 'retired reaction, 4' })
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText(/Add retired reaction/)
    ).not.toBeInTheDocument()
  })

  it('keeps an enabled local custom emoji joinable', () => {
    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([
          {
            name: 'partyparrot',
            count: 1,
            me: false,
            url: 'https://llun.test/e.gif',
            static_url: 'https://llun.test/e.png'
          }
        ])}
      />
    )

    expect(screen.getByLabelText('Add partyparrot reaction, 1')).toBeEnabled()
  })

  it('marks every chip busy while a reaction write is in flight', async () => {
    const deferred = createDeferred<unknown>()
    mockReactToStatus.mockReturnValue(deferred.promise)

    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([fire, { ...fire, name: '🎉', count: 1 }])}
      />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

    // Overlapping writes would race on the full rollups the response carries,
    // so the row refuses a second interaction visibly rather than silently —
    // via aria-disabled, not `disabled`, which would blur the control the user
    // just activated and drop keyboard focus to <body>.
    const other = screen.getByLabelText('Add 🎉 reaction, 1')
    expect(other).toHaveAttribute('aria-disabled', 'true')
    expect(trigger()).toHaveAttribute('aria-disabled', 'true')
    expect(other).toBeEnabled()
    expect(trigger()).toBeEnabled()

    // Busy means inert, not merely styled.
    fireEvent.click(other)
    expect(mockReactToStatus).toHaveBeenCalledTimes(1)

    deferred.resolve({ ok: true, reactions: [{ ...fire, count: 3, me: true }] })
    await waitFor(() =>
      expect(screen.getByLabelText('Remove 🔥 reaction, 3')).toHaveAttribute(
        'aria-disabled',
        'false'
      )
    )
  })

  it('moves focus to the trigger when removing the last reaction unmounts its chip', async () => {
    mockUnreactFromStatus.mockResolvedValue({ ok: true, reactions: [] })

    render(
      <Reactions
        currentActor={currentActor}
        status={statusWith([{ ...fire, count: 1, me: true }])}
      />
    )
    const chip = screen.getByLabelText('Remove 🔥 reaction, 1')
    chip.focus()
    fireEvent.click(chip)

    // The chip is gone because the reaction is gone — but focus has to land
    // somewhere deliberate rather than on <body>.
    await waitFor(() =>
      expect(screen.queryByLabelText(/🔥 reaction/)).not.toBeInTheDocument()
    )
    expect(trigger()).toHaveFocus()
  })
})
