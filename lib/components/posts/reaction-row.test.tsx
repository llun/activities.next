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

    expect(screen.getByLabelText('Add 🔥 reaction')).toHaveTextContent('2')
    expect(screen.getByLabelText('Add 🎉 reaction')).toHaveTextContent('1')
  })

  it('marks the viewer own reaction as pressed', () => {
    render(
      <ReactionRow
        currentActor={currentActor}
        status={statusWith([{ ...fire, me: true }])}
      />
    )

    expect(screen.getByLabelText('Remove 🔥 reaction')).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('adds a reaction optimistically and reconciles with the server', async () => {
    const served: StatusReaction[] = [{ ...fire, count: 3, me: true }]
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
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'))

    // Optimistic flip happens before the request resolves.
    expect(screen.getByLabelText('Remove 🔥 reaction')).toHaveTextContent('3')
    await waitFor(() =>
      expect(mockReactToStatus).toHaveBeenCalledWith({
        statusId: status.id,
        name: '🔥'
      })
    )
    await waitFor(() =>
      expect(onReactionsChanged).toHaveBeenCalledWith(status, served)
    )
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
    fireEvent.click(screen.getByLabelText('Remove 🔥 reaction'))

    await waitFor(() => expect(mockUnreactFromStatus).toHaveBeenCalledTimes(1))
    expect(mockReactToStatus).not.toHaveBeenCalled()
  })

  it('reverts the chip and shows an error when the request fails', async () => {
    mockReactToStatus.mockResolvedValue({ ok: false })

    render(
      <ReactionRow currentActor={currentActor} status={statusWith([fire])} />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'))

    await waitFor(() =>
      expect(screen.getByTestId('reaction-error')).toBeInTheDocument()
    )
    // Reverted: back to the un-pressed chip with its original count.
    expect(screen.getByLabelText('Add 🔥 reaction')).toHaveTextContent('2')
  })

  it('shows the server message instead of a retry prompt when it refuses', async () => {
    mockReactToStatus.mockResolvedValue({
      ok: false,
      error: 'You can only add 8 reactions to a post.'
    })

    render(
      <ReactionRow currentActor={currentActor} status={statusWith([fire])} />
    )
    fireEvent.click(screen.getByLabelText('Add 🔥 reaction'))

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
    expect(screen.getByLabelText('Add 🔥 reaction')).toHaveTextContent('🔥')
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
