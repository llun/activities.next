/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { LikeButton } from './like-button'

vi.mock('@/lib/client', () => ({
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn()
}))

const connection = vi.hoisted(() => ({ state: 'online' as string }))
vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: () => ({
    state: connection.state,
    nextProbeAt: null,
    probing: false
  })
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const actor: ActorProfile = {
  id: 'https://activities.local/users/llun',
  username: 'llun',
  domain: 'activities.local',
  name: 'Llun',
  followersUrl: 'https://activities.local/users/llun/followers',
  inboxUrl: 'https://activities.local/users/llun/inbox',
  sharedInboxUrl: 'https://activities.local/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime
}

const currentActor: ActorProfile = {
  ...actor,
  id: 'https://activities.local/users/other',
  username: 'other'
}

const status: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: actor.id,
  actor,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Post content',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('LikeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables while liking to avoid duplicate requests', async () => {
    const deferred = createDeferred<boolean>()
    ;(likeStatus as jest.Mock).mockReturnValue(deferred.promise)

    render(<LikeButton currentActor={currentActor} status={status} />)

    const button = screen.getByRole('button', { name: 'Like' })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(likeStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      deferred.resolve(true)
      await deferred.promise
    })

    expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeEnabled()
  })

  it('shows an error and keeps state when liking fails', async () => {
    ;(likeStatus as jest.Mock).mockResolvedValue(false)

    render(<LikeButton currentActor={currentActor} status={status} />)

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(
      await screen.findByText('Failed to like post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('like-error')).toHaveAttribute('data-row-overlay')
    expect(screen.getByRole('button', { name: 'Like' })).toBeEnabled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('shows an error and keeps state when unliking rejects', async () => {
    ;(undoLikeStatus as jest.Mock).mockRejectedValue(new Error('network down'))

    render(
      <LikeButton
        currentActor={currentActor}
        status={{ ...status, isActorLiked: true, totalLikes: 1 }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unlike, 1 like' }))

    expect(
      await screen.findByText('Failed to unlike post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeEnabled()
  })

  it('syncs visible like state when status props update', () => {
    const { rerender } = render(
      <LikeButton currentActor={currentActor} status={status} />
    )

    expect(screen.getByRole('button', { name: 'Like' })).toBeEnabled()

    rerender(
      <LikeButton
        currentActor={currentActor}
        status={{ ...status, isActorLiked: true, totalLikes: 3 }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Unlike, 3 likes' })
    ).toBeEnabled()
  })

  it('clears like errors when status props update', async () => {
    ;(likeStatus as jest.Mock).mockResolvedValue(false)
    const { rerender } = render(
      <LikeButton currentActor={currentActor} status={status} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(
      await screen.findByText('Failed to like post. Please try again.')
    ).toHaveAttribute('role', 'alert')

    rerender(
      <LikeButton
        currentActor={currentActor}
        status={{ ...status, totalLikes: 1 }}
      />
    )

    expect(screen.queryByTestId('like-error')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Like, 1 like' })).toBeEnabled()
  })
})

describe('LikeButton offline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connection.state = 'offline'
    // Radix Tooltip content measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })
  afterEach(() => {
    connection.state = 'online'
  })

  it('is aria-disabled but focusable, and a click makes no request', () => {
    render(<LikeButton currentActor={currentActor} status={status} />)
    const button = screen.getByRole('button', { name: 'Like' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    button.focus()
    expect(button).toHaveFocus()

    fireEvent.click(button)

    expect(likeStatus).not.toHaveBeenCalled()
    expect(
      screen.getByText("You're offline", { selector: '[role=alert]' })
    ).toBeInTheDocument()
  })

  it('shows the tooltip on focus', async () => {
    render(<LikeButton currentActor={currentActor} status={status} />)
    act(() => screen.getByRole('button', { name: 'Like' }).focus())

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "You're offline"
    )
  })

  it('does not pop the tooltip open on going offline after a focus while online', async () => {
    connection.state = 'online'
    const { rerender } = render(
      <LikeButton currentActor={currentActor} status={status} />
    )
    const button = screen.getByRole('button', { name: 'Like' })
    act(() => button.focus())
    act(() => button.blur())

    connection.state = 'offline'
    rerender(<LikeButton currentActor={currentActor} status={status} />)
    await act(async () => {})

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('drops the native title while offline, keeping the aria-label', () => {
    render(<LikeButton currentActor={currentActor} status={status} />)
    const button = screen.getByRole('button', { name: 'Like' })
    expect(button).not.toHaveAttribute('title')

    connection.state = 'online'
    cleanup()
    render(<LikeButton currentActor={currentActor} status={status} />)
    expect(screen.getByRole('button', { name: 'Like' })).toHaveAttribute(
      'title',
      'Like'
    )
  })

  it('keeps focus and logs no Radix warning when going offline', () => {
    // Radix 1.3.0 reports controlled/uncontrolled switches via console.warn.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    connection.state = 'online'
    const { rerender } = render(
      <LikeButton currentActor={currentActor} status={status} />
    )
    const button = screen.getByRole('button', { name: 'Like' })
    act(() => button.focus())

    connection.state = 'offline'
    rerender(<LikeButton currentActor={currentActor} status={status} />)

    expect(screen.getByRole('button', { name: 'Like' })).toBe(button)
    expect(button).toHaveFocus()
    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    error.mockRestore()
    warn.mockRestore()
  })

  it('shows no tooltip on focus or hover while online', async () => {
    connection.state = 'online'
    render(<LikeButton currentActor={currentActor} status={status} />)
    const button = screen.getByRole('button', { name: 'Like' })
    act(() => button.focus())
    fireEvent.pointerMove(button)
    fireEvent.mouseEnter(button)
    await act(async () => {})

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('has no aria-disabled when unreachable', () => {
    connection.state = 'unreachable'
    render(<LikeButton currentActor={currentActor} status={status} />)
    expect(screen.getByRole('button', { name: 'Like' })).not.toHaveAttribute(
      'aria-disabled'
    )
  })
})
