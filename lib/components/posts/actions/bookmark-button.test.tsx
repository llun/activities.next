/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { bookmarkStatus, undoBookmarkStatus } from '@/lib/client'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { BookmarkButton } from './bookmark-button'

jest.mock('@/lib/client', () => ({
  bookmarkStatus: jest.fn(),
  undoBookmarkStatus: jest.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const status: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
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
  },
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

describe('BookmarkButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not reserve idle error message space in the action grid', () => {
    render(<BookmarkButton status={status} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('bookmark-error')).not.toBeInTheDocument()
  })

  it('shows an error and keeps state when bookmarking fails', async () => {
    ;(bookmarkStatus as jest.Mock).mockResolvedValue(false)
    const onBookmarkChanged = jest.fn()

    render(
      <BookmarkButton status={status} onBookmarkChanged={onBookmarkChanged} />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))

    expect(
      await screen.findByText('Failed to bookmark post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeInTheDocument()
    expect(onBookmarkChanged).not.toHaveBeenCalled()
  })

  it('shows an error and keeps state when removing a bookmark fails', async () => {
    ;(undoBookmarkStatus as jest.Mock).mockResolvedValue(false)
    const onBookmarkChanged = jest.fn()

    render(
      <BookmarkButton
        status={{ ...status, isActorBookmarked: true }}
        onBookmarkChanged={onBookmarkChanged}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }))

    expect(
      await screen.findByText('Failed to remove bookmark. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(
      screen.getByRole('button', { name: 'Remove bookmark' })
    ).toBeInTheDocument()
    expect(onBookmarkChanged).not.toHaveBeenCalled()
  })

  it('shows an error when the bookmark request rejects', async () => {
    ;(bookmarkStatus as jest.Mock).mockRejectedValue(new Error('network down'))

    render(<BookmarkButton status={status} />)

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))

    expect(
      await screen.findByText('Failed to bookmark post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Bookmark' })).toBeEnabled()
  })

  it('auto-dismisses bookmark errors after a short delay', async () => {
    jest.useFakeTimers()
    let resolveBookmark: (value: boolean) => void = () => {}
    const bookmarkPromise = new Promise<boolean>((resolve) => {
      resolveBookmark = resolve
    })
    ;(bookmarkStatus as jest.Mock).mockReturnValue(bookmarkPromise)

    try {
      render(<BookmarkButton status={status} />)

      fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))

      await act(async () => {
        resolveBookmark(false)
        await bookmarkPromise
      })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to bookmark post. Please try again.'
      )

      act(() => {
        jest.advanceTimersByTime(4000)
      })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})
