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
  getBookmarkFolders,
  setStatusBookmarkFolder
} from '@/lib/client'
import { resetBookmarkFolderStore } from '@/lib/components/bookmarks/bookmarkFolderStore'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { PostMenu } from './post-menu'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  getRelationship: vi.fn().mockResolvedValue(null),
  getStatusById: vi.fn().mockResolvedValue(null),
  getBookmarkFolders: vi.fn(),
  createBookmarkFolder: vi.fn(),
  setStatusBookmarkFolder: vi.fn(),
  getTranslationCapability: vi.fn().mockResolvedValue({
    enabled: false,
    defaultLanguage: null
  }),
  getTranslationLanguages: vi.fn().mockResolvedValue({})
}))

const at = new Date('2026-04-26T10:00:00.000Z').getTime()

const folder = (id: string, name: string) => ({
  id,
  name,
  created_at: '2026-04-26T10:00:00.000Z',
  updated_at: '2026-04-26T10:00:00.000Z'
})

const status: StatusNote = {
  id: 'https://remote.example/users/jasmine/statuses/post-9',
  actorId: 'https://remote.example/users/jasmine',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: at,
  updatedAt: at,
  type: StatusType.enum.Note,
  url: 'https://remote.example/@jasmine/post-9',
  text: 'Someone else post',
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

const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

const openFolderSubmenu = async () => {
  const menu = await openMenu()
  fireEvent.keyDown(
    within(menu).getByRole('menuitem', { name: 'Bookmark folder' }),
    { key: 'ArrowRight' }
  )
  return waitFor(() => {
    const menus = screen.getAllByRole('menu')
    const submenu = menus[menus.length - 1]
    expect(submenu).not.toBe(menu)
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'Birding' })
    ).toBeInTheDocument()
    return submenu
  })
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('PostMenu bookmark folder submenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    resetBookmarkFolderStore()
    ;(getBookmarkFolders as jest.Mock).mockResolvedValue([
      folder('f-recipes', 'Recipes'),
      folder('f-birding', 'Birding')
    ])
    ;(setStatusBookmarkFolder as jest.Mock).mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('lists No folder and every folder, checking the current one', async () => {
    render(
      <PostMenu
        status={{
          ...status,
          isActorBookmarked: true,
          bookmarkFolderId: 'f-recipes'
        }}
        isOwner={false}
        canEdit={false}
      />
    )

    const submenu = await openFolderSubmenu()
    const radios = within(submenu).getAllByRole('menuitemradio')
    expect(radios.map((item) => item.textContent)).toEqual([
      'No folder',
      'Birding',
      'Recipes'
    ])
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'Recipes' })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'No folder' })
    ).toHaveAttribute('aria-checked', 'false')
    expect(
      within(submenu).getByRole('menuitem', { name: 'New folder…' })
    ).toBeInTheDocument()
  })

  it('checks nothing on a post that is not bookmarked, and fetches folders once', async () => {
    render(
      <>
        <PostMenu status={status} isOwner={false} canEdit={false} />
      </>
    )

    const submenu = await openFolderSubmenu()
    for (const item of within(submenu).getAllByRole('menuitemradio')) {
      expect(item).toHaveAttribute('aria-checked', 'false')
    }
    fireEvent.keyDown(submenu, { key: 'Escape' })
    await openFolderSubmenu()

    expect(getBookmarkFolders).toHaveBeenCalledTimes(1)
  })

  it('bookmarks and files an unbookmarked post, then shows the check', async () => {
    const onBookmarkFolderChanged = vi.fn()
    render(
      <PostMenu
        status={status}
        isOwner={false}
        canEdit={false}
        onBookmarkFolderChanged={onBookmarkFolderChanged}
      />
    )

    const submenu = await openFolderSubmenu()
    await act(async () => {
      fireEvent.click(
        within(submenu).getByRole('menuitemradio', { name: 'Birding' })
      )
    })

    expect(setStatusBookmarkFolder).toHaveBeenCalledWith({
      statusId: status.id,
      folderId: 'f-birding'
    })
    expect(onBookmarkFolderChanged).toHaveBeenCalledWith(status, 'f-birding')
    const reopened = await openFolderSubmenu()
    expect(
      within(reopened).getByRole('menuitemradio', { name: 'Birding' })
    ).toHaveAttribute('aria-checked', 'true')
  })

  it('unfiles with No folder', async () => {
    render(
      <PostMenu
        status={{
          ...status,
          isActorBookmarked: true,
          bookmarkFolderId: 'f-birding'
        }}
        isOwner={false}
        canEdit={false}
      />
    )

    const submenu = await openFolderSubmenu()
    await act(async () => {
      fireEvent.click(
        within(submenu).getByRole('menuitemradio', { name: 'No folder' })
      )
    })

    expect(setStatusBookmarkFolder).toHaveBeenCalledWith({
      statusId: status.id,
      folderId: null
    })
  })

  it('shows no check once the row says the bookmark is gone', async () => {
    render(
      <PostMenu
        status={{
          ...status,
          isActorBookmarked: true,
          bookmarkFolderId: 'f-birding'
        }}
        isBookmarked={false}
        isOwner={false}
        canEdit={false}
      />
    )

    const submenu = await openFolderSubmenu()
    expect(
      within(submenu).getByRole('menuitemradio', { name: 'Birding' })
    ).toHaveAttribute('aria-checked', 'false')
  })

  it('creates a folder from New folder… and files the post in it', async () => {
    ;(createBookmarkFolder as jest.Mock).mockResolvedValue(
      folder('f-new', 'Read later')
    )
    const onBookmarkFolderChanged = vi.fn()
    render(
      <PostMenu
        status={status}
        isOwner={false}
        canEdit={false}
        onBookmarkFolderChanged={onBookmarkFolderChanged}
      />
    )

    const submenu = await openFolderSubmenu()
    await act(async () => {
      fireEvent.click(
        within(submenu).getByRole('menuitem', { name: 'New folder…' })
      )
    })
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: '  Read later ' }
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    })

    expect(createBookmarkFolder).toHaveBeenCalledWith('Read later')
    expect(setStatusBookmarkFolder).toHaveBeenCalledWith({
      statusId: status.id,
      folderId: 'f-new'
    })
    expect(onBookmarkFolderChanged).toHaveBeenCalledWith(status, 'f-new')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    const reopened = await openFolderSubmenu()
    expect(
      within(reopened).getByRole('menuitemradio', { name: 'Read later' })
    ).toHaveAttribute('aria-checked', 'true')
  })
})
