/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getBookmarks, undoBookmarkStatus } from '@/lib/client'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { BookmarksTimeline } from './BookmarksTimeline'

jest.mock('@/lib/client', () => ({
  bookmarkStatus: jest.fn(),
  getBookmarks: jest.fn(),
  likeStatus: jest.fn(),
  repostStatus: jest.fn(),
  undoBookmarkStatus: jest.fn(),
  undoLikeStatus: jest.fn(),
  undoRepostStatus: jest.fn()
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn()
  })
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const actor = {
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

const bookmarkedStatus: StatusNote = {
  id: 'https://remote.example/users/author/statuses/bookmarked',
  actorId: 'https://remote.example/users/author',
  actor: {
    ...actor,
    id: 'https://remote.example/users/author',
    username: 'author',
    domain: 'remote.example',
    name: 'Author',
    followersUrl: 'https://remote.example/users/author/followers',
    inboxUrl: 'https://remote.example/users/author/inbox',
    sharedInboxUrl: 'https://remote.example/inbox'
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://remote.example/@author/bookmarked',
  text: 'Bookmarked post',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: true,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('BookmarksTimeline', () => {
  let intersectionObserverCallback:
    | ((entries: IntersectionObserverEntry[]) => void)
    | null = null
  let intersectionObserverDisconnect: jest.Mock
  let intersectionObserverObserve: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    intersectionObserverCallback = null
    intersectionObserverDisconnect = jest.fn()
    intersectionObserverObserve = jest.fn()
    ;(undoBookmarkStatus as jest.Mock).mockResolvedValue(true)
    ;(getBookmarks as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxBookmarkId: null,
      prevMinBookmarkId: null
    })
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: jest.fn().mockImplementation((callback) => {
        intersectionObserverCallback = callback
        return {
          disconnect: intersectionObserverDisconnect,
          observe: intersectionObserverObserve
        }
      })
    })
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: jest.fn().mockImplementation(() => ({
        disconnect: jest.fn(),
        observe: jest.fn()
      }))
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('removes a post from the list after unbookmarking it', async () => {
    render(
      <BookmarksTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[bookmarkedStatus]}
        initialNextMaxBookmarkId={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }))

    await waitFor(() => {
      expect(screen.queryByText('Bookmarked post')).not.toBeInTheDocument()
    })
    expect(undoBookmarkStatus).toHaveBeenCalledWith({
      statusId: bookmarkedStatus.id
    })
    expect(screen.getByText('No bookmarks yet')).toBeInTheDocument()
  })

  it('continues loading when a bookmark page has no readable statuses', async () => {
    ;(getBookmarks as jest.Mock)
      .mockResolvedValueOnce({
        statuses: [],
        nextMaxBookmarkId: 'bookmark-2',
        prevMinBookmarkId: null
      })
      .mockResolvedValueOnce({
        statuses: [bookmarkedStatus],
        nextMaxBookmarkId: null,
        prevMinBookmarkId: 'bookmark-2'
      })

    render(
      <BookmarksTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[]}
        initialNextMaxBookmarkId="bookmark-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('Bookmarked post')
    expect(getBookmarks).toHaveBeenNthCalledWith(1, {
      maxBookmarkId: 'bookmark-1'
    })
    expect(getBookmarks).toHaveBeenNthCalledWith(2, {
      maxBookmarkId: 'bookmark-2'
    })
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('disconnects the observer when the load-more sentinel is removed', async () => {
    ;(getBookmarks as jest.Mock).mockResolvedValueOnce({
      statuses: [bookmarkedStatus],
      nextMaxBookmarkId: null,
      prevMinBookmarkId: null
    })

    render(
      <BookmarksTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[]}
        initialNextMaxBookmarkId="bookmark-1"
      />
    )

    await waitFor(() => {
      expect(intersectionObserverObserve).toHaveBeenCalled()
    })

    await act(async () => {
      intersectionObserverCallback?.([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    await screen.findByText('Bookmarked post')
    await waitFor(() => {
      expect(intersectionObserverDisconnect).toHaveBeenCalled()
    })
  })
})
