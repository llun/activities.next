/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getFavourites, undoLikeStatus } from '@/lib/client'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { FavoritesTimeline } from './FavoritesTimeline'

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  getFavourites: vi.fn(),
  likeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  undoRepostStatus: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn()
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

const favouritedStatus: StatusNote = {
  id: 'https://remote.example/users/author/statuses/favourited',
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
  url: 'https://remote.example/@author/favourited',
  text: 'Favourited post',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: true,
  isActorBookmarked: false,
  totalLikes: 1,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('FavoritesTimeline', () => {
  let intersectionObserverCallback:
    | ((entries: IntersectionObserverEntry[]) => void)
    | null = null
  let intersectionObserverDisconnect: jest.Mock
  let intersectionObserverObserve: jest.Mock

  beforeEach(() => {
    vi.clearAllMocks()
    intersectionObserverCallback = null
    intersectionObserverDisconnect = vi.fn()
    intersectionObserverObserve = vi.fn()
    ;(undoLikeStatus as jest.Mock).mockResolvedValue(true)
    ;(getFavourites as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxFavouriteId: null,
      prevMinFavouriteId: null
    })
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function (callback) {
        intersectionObserverCallback = callback
        return {
          disconnect: intersectionObserverDisconnect,
          observe: intersectionObserverObserve
        }
      })
    })
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: vi.fn().mockImplementation(function () {
        return {
          disconnect: vi.fn(),
          observe: vi.fn()
        }
      })
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('removes a post from the list after unfavouriting it', async () => {
    render(
      <FavoritesTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[favouritedStatus]}
        initialNextMaxFavouriteId={null}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Unlike/ }))

    await waitFor(() => {
      expect(screen.queryByText('Favourited post')).not.toBeInTheDocument()
    })
    expect(undoLikeStatus).toHaveBeenCalledWith({
      statusId: favouritedStatus.id
    })
    expect(screen.getByText('No favorites yet')).toBeInTheDocument()
  })

  it('continues loading when a favourite page has no readable statuses', async () => {
    ;(getFavourites as jest.Mock)
      .mockResolvedValueOnce({
        statuses: [],
        nextMaxFavouriteId: 'favourite-2',
        prevMinFavouriteId: null
      })
      .mockResolvedValueOnce({
        statuses: [favouritedStatus],
        nextMaxFavouriteId: null,
        prevMinFavouriteId: 'favourite-2'
      })

    render(
      <FavoritesTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[]}
        initialNextMaxFavouriteId="favourite-1"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('Favourited post')
    expect(getFavourites).toHaveBeenNthCalledWith(1, {
      maxFavouriteId: 'favourite-1'
    })
    expect(getFavourites).toHaveBeenNthCalledWith(2, {
      maxFavouriteId: 'favourite-2'
    })
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('disconnects the observer when the load-more sentinel is removed', async () => {
    ;(getFavourites as jest.Mock).mockResolvedValueOnce({
      statuses: [favouritedStatus],
      nextMaxFavouriteId: null,
      prevMinFavouriteId: null
    })

    render(
      <FavoritesTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[]}
        initialNextMaxFavouriteId="favourite-1"
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

    await screen.findByText('Favourited post')
    await waitFor(() => {
      expect(intersectionObserverDisconnect).toHaveBeenCalled()
    })
  })
})
