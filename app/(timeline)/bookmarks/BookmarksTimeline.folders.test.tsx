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

import {
  createBookmarkFolder,
  deleteBookmarkFolder,
  getBookmarks,
  setStatusBookmarkFolder
} from '@/lib/client'
import { resetBookmarkFolderStore } from '@/lib/components/bookmarks/bookmarkFolderStore'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { BookmarksTimeline } from './BookmarksTimeline'

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  getBookmarks: vi.fn(),
  getBookmarkFolders: vi.fn(),
  createBookmarkFolder: vi.fn(),
  renameBookmarkFolder: vi.fn(),
  deleteBookmarkFolder: vi.fn(),
  setStatusBookmarkFolder: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
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
  text: 'A filed recipe',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: true,
  bookmarkFolderId: 'f-recipes',
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

const folder = (id: string, name: string): BookmarkFolderEntity => ({
  id,
  name,
  created_at: '2026-04-26T10:00:00.000Z',
  updated_at: '2026-04-26T10:00:00.000Z'
})

const FOLDERS = [folder('f-birding', 'Birding'), folder('f-recipes', 'Recipes')]

const renderTimeline = (
  props: Partial<Parameters<typeof BookmarksTimeline>[0]> = {}
) =>
  render(
    <BookmarksTimeline
      host="activities.local"
      currentActor={actor}
      currentTime={currentTime}
      statuses={[]}
      initialNextMaxBookmarkId={null}
      {...props}
    />
  )

const folderNav = () =>
  screen.queryByRole('navigation', { name: 'Bookmark folders' })

const pickView = async (name: string) => {
  fireEvent.keyDown(within(folderNav()!).getByRole('button'), {
    key: 'ArrowDown'
  })
  const menu = await screen.findByRole('menu')
  await act(async () => {
    fireEvent.click(within(menu).getByRole('menuitem', { name }))
  })
}

describe('BookmarksTimeline folders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBookmarkFolderStore()
    window.history.replaceState(null, '', '/bookmarks')
    ;(getBookmarks as jest.Mock).mockResolvedValue({
      statuses: [],
      nextMaxBookmarkId: null,
      prevMinBookmarkId: null
    })
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

  it('hides the folder select without folders and offers New folder', async () => {
    ;(createBookmarkFolder as jest.Mock).mockResolvedValue(
      folder('f-new', 'Read later')
    )
    renderTimeline()

    expect(folderNav()).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Manage folders' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('New folder'), {
      target: { value: 'Read later' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    })

    expect(createBookmarkFolder).toHaveBeenCalledWith('Read later')
    expect(
      within(dialog).getByRole('list', { name: 'Your bookmark folders' })
    ).toHaveTextContent('Read later')
    // The open dialog hides the page from the accessibility tree.
    expect(
      screen.getByRole('navigation', {
        name: 'Bookmark folders',
        hidden: true
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage folders', hidden: true })
    ).toBeInTheDocument()
  })

  it('filters in place and keeps ?folder= in step', async () => {
    renderTimeline({ folders: FOLDERS })

    expect(within(folderNav()!).getByRole('button')).toHaveTextContent(
      'All bookmarks'
    )

    await pickView('Recipes')

    expect(getBookmarks).toHaveBeenLastCalledWith({ folderId: 'f-recipes' })
    expect(window.location.search).toBe('?folder=f-recipes')
    expect(await screen.findByText('This folder is empty')).toBeInTheDocument()

    await pickView('Unfiled')
    expect(getBookmarks).toHaveBeenLastCalledWith({ folderId: 'none' })
    expect(window.location.search).toBe('?folder=none')
    expect(await screen.findByText('No unfiled bookmarks')).toBeInTheDocument()

    await pickView('All bookmarks')
    expect(getBookmarks).toHaveBeenLastCalledWith({ folderId: undefined })
    expect(window.location.search).toBe('')
  })

  it('opens on the folder the page was given', () => {
    renderTimeline({
      folders: FOLDERS,
      initialFolder: 'f-recipes',
      statuses: [filedStatus]
    })

    expect(within(folderNav()!).getByRole('button')).toHaveTextContent(
      'Recipes'
    )
    expect(screen.getByText('A filed recipe')).toBeInTheDocument()
  })

  it('drops a post filed out of the folder on screen', async () => {
    ;(setStatusBookmarkFolder as jest.Mock).mockResolvedValue(true)
    renderTimeline({
      folders: FOLDERS,
      initialFolder: 'f-recipes',
      statuses: [filedStatus]
    })

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
      key: 'ArrowDown'
    })
    const menu = await screen.findByRole('menu')
    fireEvent.keyDown(
      within(menu).getByRole('menuitem', { name: 'Bookmark folder' }),
      { key: 'ArrowRight' }
    )
    const submenu = await waitFor(() => {
      const menus = screen.getAllByRole('menu')
      expect(menus.length).toBeGreaterThan(1)
      return menus[menus.length - 1]
    })
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'Recipes' })
    ).toHaveAttribute('aria-checked', 'true')
    await act(async () => {
      fireEvent.click(
        within(submenu).getByRole('menuitemradio', { name: 'Birding' })
      )
    })

    expect(setStatusBookmarkFolder).toHaveBeenCalledWith({
      statusId: filedStatus.id,
      folderId: 'f-birding'
    })
    await waitFor(() =>
      expect(screen.queryByText('A filed recipe')).not.toBeInTheDocument()
    )
  })

  it('deletes a folder after the confirmation and leaves it when it was open', async () => {
    ;(deleteBookmarkFolder as jest.Mock).mockResolvedValue(true)
    renderTimeline({ folders: FOLDERS, initialFolder: 'f-recipes' })

    fireEvent.click(screen.getByRole('button', { name: 'Manage folders' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete Recipes' })
    )
    expect(dialog).toHaveTextContent(
      'Bookmarks in this folder stay in All bookmarks.'
    )
    expect(deleteBookmarkFolder).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Delete folder' })
      )
    })

    expect(deleteBookmarkFolder).toHaveBeenCalledWith('f-recipes')
    expect(
      within(dialog).getByRole('list', { name: 'Your bookmark folders' })
    ).not.toHaveTextContent('Recipes')
    expect(getBookmarks).toHaveBeenLastCalledWith({ folderId: undefined })
    expect(window.location.search).toBe('')
  })
})
