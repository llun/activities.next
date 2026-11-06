/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { bookmarkStatus, undoBookmarkStatus } from '@/lib/client'
import { resetBookmarkFolderStore } from '@/lib/components/bookmarks/bookmarkFolderStore'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { FavoritesTimeline } from './FavoritesTimeline'

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  getFavourites: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  getBookmarkFolders: vi.fn().mockResolvedValue([
    {
      id: 'f-birding',
      name: 'Birding',
      created_at: '2026-04-26T10:00:00.000Z',
      updated_at: '2026-04-26T10:00:00.000Z'
    }
  ]),
  setStatusBookmarkFolder: vi.fn().mockResolvedValue(true),
  getTranslationCapability: vi.fn().mockResolvedValue({
    enabled: false,
    defaultLanguage: null
  }),
  getTranslationLanguages: vi.fn().mockResolvedValue({})
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
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

// As hydration hands it over: bookmarked and filed in Birding.
const filedStatus: StatusNote = {
  id: 'https://remote.example/users/author/statuses/filed',
  actorId: 'https://remote.example/users/author',
  actor: {
    ...actor,
    id: 'https://remote.example/users/author',
    username: 'author',
    domain: 'remote.example',
    name: 'Author'
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://remote.example/@author/filed',
  text: 'A filed and liked post',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: true,
  isActorBookmarked: true,
  bookmarkFolderId: 'f-birding',
  totalLikes: 1,
  totalShares: 0,
  attachments: [],
  tags: []
}

const openFolderSubmenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  const menu = await screen.findByRole('menu')
  fireEvent.keyDown(
    within(menu).getByRole('menuitem', { name: 'Bookmark folder' }),
    { key: 'ArrowRight' }
  )
  return waitFor(() => {
    const menus = screen.getAllByRole('menu')
    expect(menus.length).toBeGreaterThan(1)
    const submenu = menus[menus.length - 1]
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'Birding' })
    ).toBeInTheDocument()
    return submenu
  })
}

const closeMenus = async () => {
  fireEvent.keyDown(screen.getAllByRole('menu')[0], { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
}

// A whole feed, not a menu on its own: the feed's own `onBookmarkChanged`
// decides what folder the re-rendered status carries.
describe('FavoritesTimeline bookmark folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBookmarkFolderStore()
    ;(bookmarkStatus as jest.Mock).mockResolvedValue(true)
    ;(undoBookmarkStatus as jest.Mock).mockResolvedValue(true)
    for (const name of ['IntersectionObserver', 'ResizeObserver']) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        value: vi.fn().mockImplementation(function () {
          return { disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() }
        })
      })
    }
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
    Reflect.deleteProperty(globalThis, 'ResizeObserver')
  })

  it('shows No folder after a filed post is unbookmarked and bookmarked again', async () => {
    render(
      <FavoritesTimeline
        host="activities.local"
        currentActor={actor}
        currentTime={currentTime}
        statuses={[filedStatus]}
        initialNextMaxFavouriteId={null}
      />
    )

    const filed = await openFolderSubmenu()
    expect(
      within(filed).getByRole('menuitemradio', { name: 'Birding' })
    ).toHaveAttribute('aria-checked', 'true')
    await closeMenus()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Bookmark' }))
    })
    expect(undoBookmarkStatus).toHaveBeenCalledTimes(1)
    expect(bookmarkStatus).toHaveBeenCalledTimes(1)

    // The server's new bookmark is unfiled.
    const rebookmarked = await openFolderSubmenu()
    expect(
      within(rebookmarked).getByRole('menuitemradio', { name: 'No folder' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      within(rebookmarked).getByRole('menuitemradio', { name: 'Birding' })
    ).toHaveAttribute('aria-checked', 'false')
  })
})
