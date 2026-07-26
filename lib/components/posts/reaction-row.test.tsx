/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { ReactionRow } from '@/lib/components/posts/reaction-row'
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

describe('ReactionRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a chip per reaction with its count', () => {
    render(
      <ReactionRow
        currentActor={currentActor}
        status={statusWith([fire, { ...fire, name: '🎉', count: 1 }])}
      />
    )

    expect(screen.getByLabelText('Add 🔥 reaction, 2')).toHaveTextContent('2')
    expect(screen.getByLabelText('Add 🎉 reaction, 1')).toHaveTextContent('1')
  })

  it('marks the viewer own reaction as pressed', () => {
    render(
      <ReactionRow
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
      <ReactionRow
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
      <ReactionRow
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
      <ReactionRow currentActor={currentActor} status={statusWith([fire])} />
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
      <ReactionRow currentActor={currentActor} status={statusWith([fire])} />
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
      <ReactionRow
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
    render(<ReactionRow status={statusWith([fire])} />)

    // Readable, but not a control: a disabled button would drop the count out
    // of the tab order and grey it out for everyone who cannot react.
    // Exposed as an image with the emoji in its label: the glyph is aria-hidden,
    // so the label is the only thing that names which reaction this count is for.
    const chip = screen.getByRole('img', { name: '🔥 reaction, 2' })
    expect(chip).toHaveTextContent('2')
    expect(chip.tagName).toBe('SPAN')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing for a logged-out reader on a post with no reactions', () => {
    const { container } = render(<ReactionRow status={statusWith([])} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows a remote custom emoji reaction without offering to join it', () => {
    render(
      <ReactionRow
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
      <ReactionRow
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
      <ReactionRow
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

  it('adds rather than removes when the picker returns an existing reaction', async () => {
    render(
      <ReactionRow
        currentActor={currentActor}
        status={statusWith([{ ...fire, me: true }])}
      />
    )
    fireEvent.click(screen.getByLabelText('Add reaction'))
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

  it('disables every chip while a reaction write is in flight', async () => {
    let resolveRequest: (value: unknown) => void = () => {}
    mockReactToStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      })
    )

    render(
      <ReactionRow
        currentActor={currentActor}
        status={statusWith([fire, { ...fire, name: '🎉', count: 1 }])}
      />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction, 2'))

    // Overlapping writes would race on the full rollups the response carries,
    // so the row refuses a second interaction visibly rather than silently.
    expect(screen.getByLabelText('Add 🎉 reaction, 1')).toBeDisabled()
    expect(screen.getByLabelText('Add reaction')).toBeDisabled()

    resolveRequest({ ok: true, reactions: [{ ...fire, count: 3, me: true }] })
    await waitFor(() =>
      expect(screen.getByLabelText('Remove 🔥 reaction, 3')).toBeEnabled()
    )
  })

  it('returns focus to the trigger when the picker closes', async () => {
    render(<ReactionRow currentActor={currentActor} status={statusWith([])} />)
    const trigger = screen.getByLabelText('Add reaction')
    fireEvent.click(trigger)

    await screen.findByRole('dialog', { name: 'Choose a reaction' })
    fireEvent.keyDown(window, { key: 'Escape' })

    // Otherwise a keyboard user's focus is dumped on <body>.
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('opens the picker and reacts with the chosen emoji', async () => {
    mockReactToStatus.mockResolvedValue({
      ok: true,
      reactions: [{ ...fire, count: 1, me: true }]
    })

    render(<ReactionRow currentActor={currentActor} status={statusWith([])} />)
    fireEvent.click(screen.getByLabelText('Add reaction'))

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
})
