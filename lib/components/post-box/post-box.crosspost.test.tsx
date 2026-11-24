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
  waitFor
} from '@testing-library/react'

import { getBlueskyAccount } from '@/lib/client/blueskyAccount'
import type { DraftRecord } from '@/lib/client/drafts'
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { EditableStatus, Status, StatusType } from '@/lib/types/domain/status'
import type { BlueskyLinkedAccount } from '@/lib/utils/blueskyAccount'
import { BLUESKY_CROSSPOST_CUT_MESSAGE } from '@/lib/utils/blueskyText'

import { PostBox } from './post-box'
import {
  createNoteMock,
  createPollMock,
  currentTime,
  editStatus,
  openPostOptions,
  profile
} from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn(),
  deleteUnpostedMedia: vi.fn().mockResolvedValue(true),
  deleteUnpostedFitnessFile: vi.fn().mockResolvedValue(true),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGallerySettings: vi.fn().mockResolvedValue(null),
  getMedia: vi.fn(),
  suggestMediaSubjects: vi.fn()
}))

vi.mock('@/lib/client/blueskyAccount', () => ({
  getBlueskyAccount: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn()
}))

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: vi.fn(() => ({ state: 'online' }))
}))

vi.mock('@/lib/components/drafts/DraftsProvider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrafts: vi.fn(() => null)
}))

const linkedAccount = (crosspostByDefault = true): BlueskyLinkedAccount => ({
  did: 'did:plc:me1234567890abcdefghijkl',
  handle: 'me.bsky.social',
  pdsUrl: 'https://bsky.social',
  authType: 'oauth',
  domainHandle: false,
  sessionActive: true,
  lastSyncedAt: null,
  syncError: null,
  crosspostByDefault
})

const CROSSPOST = 'Also post to Bluesky'

const renderPostBox = async (
  props: Partial<Parameters<typeof PostBox>[0]> = {}
) => {
  const result = render(
    <InstanceLimitsProvider maxStatusCharacters={5000}>
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
        {...props}
      />
    </InstanceLimitsProvider>
  )
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

const type = (value: string) =>
  fireEvent.change(screen.getByRole('textbox'), { target: { value } })

const post = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Post' }))
  await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
  return createNoteMock.mock.calls[0][0]
}

const crosspostItem = async () => {
  await openPostOptions()
  return screen.queryByRole('menuitemcheckbox', { name: CROSSPOST })
}

const closeMenu = () =>
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

const chooseVisibility = async (name: RegExp) => {
  await openPostOptions()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Visibility/ }), {
    key: 'ArrowRight'
  })
  fireEvent.click(await screen.findByRole('menuitemradio', { name }))
  await waitFor(() =>
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  )
}

const ownPost = {
  id: 'https://activities.local/users/llun/statuses/own-1',
  url: 'https://activities.local/@llun/own-1',
  actorId: profile.id,
  actor: profile,
  type: StatusType.enum.Note,
  text: 'my post',
  tags: [],
  to: [],
  cc: []
} as unknown as Status

const othersPost = {
  ...ownPost,
  id: 'https://other.example/users/bob/statuses/1',
  url: 'https://other.example/@bob/1',
  actorId: 'https://other.example/users/bob',
  actor: undefined
} as unknown as Status

describe('PostBox cross-posting to Bluesky', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBlueskyAccountStore()
    vi.mocked(getBlueskyAccount).mockResolvedValue(null)
    vi.mocked(useConnectionStatus).mockReturnValue({ state: 'online' } as never)
    vi.mocked(useDrafts).mockReturnValue(null)
    createNoteMock.mockResolvedValue({
      status: { ...editStatus, id: 'new' },
      attachments: []
    })
    createPollMock.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    resetBlueskyAccountStore()
  })

  it('loads the linked account for a new post and sends its default', async () => {
    vi.mocked(getBlueskyAccount).mockResolvedValue({
      oauthAvailable: true,
      account: linkedAccount(true),
      instanceHandle: null
    })
    await renderPostBox()
    await waitFor(() => expect(getBlueskyAccount).toHaveBeenCalled())

    const item = await crosspostItem()
    expect(item).toHaveAttribute('aria-checked', 'true')
    closeMenu()

    type('hello')
    expect(await post()).toMatchObject({ blueskyCrosspost: true })
  })

  it('sends false once the switch is turned off for this post', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox()

    const item = await crosspostItem()
    fireEvent.click(item as HTMLElement)
    expect(
      screen.getByRole('menuitemcheckbox', { name: CROSSPOST })
    ).toHaveAttribute('aria-checked', 'false')
    closeMenu()

    type('hello')
    expect(await post()).toMatchObject({ blueskyCrosspost: false })
  })

  it('starts off when the account default is off', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(false))
    await renderPostBox()

    expect(await crosspostItem()).toHaveAttribute('aria-checked', 'false')
    closeMenu()
    type('hello')
    expect(await post()).toMatchObject({ blueskyCrosspost: false })
  })

  it('has no switch and sends nothing without a linked account', async () => {
    setLinkedBlueskyAccount(profile.id, null)
    await renderPostBox()

    expect(await crosspostItem()).not.toBeInTheDocument()
    closeMenu()
    type('hello')
    expect((await post()).blueskyCrosspost).toBeUndefined()
  })

  it('sends the switch with a poll too', async () => {
    // The poll editor's Radix Switch measures itself; jsdom has none.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox()
    type('Which one?')

    await openPostOptions()
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Poll' }))
    const [first, second] = await screen.findAllByPlaceholderText(/^Choice/)
    fireEvent.change(first, { target: { value: 'a' } })
    fireEvent.change(second, { target: { value: 'b' } })
    fireEvent.input(second)
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPollMock).toHaveBeenCalled())
    expect(createPollMock.mock.calls[0][0]).toMatchObject({
      blueskyCrosspost: true
    })
  })

  it('is disabled with the reason when the post is not public', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox()
    await chooseVisibility(/unlisted/i)

    const item = await crosspostItem()
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('aria-checked', 'false')
    expect(item).toHaveAccessibleDescription('Only public posts go to Bluesky.')
  })

  it('offers the switch on a reply to the own post, not to someone else’s', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox({ replyStatus: ownPost })
    expect(await crosspostItem()).toBeInTheDocument()
    closeMenu()
    cleanup()

    await renderPostBox({ replyStatus: othersPost })
    expect(await crosspostItem()).not.toBeInTheDocument()
    closeMenu()
    type('@bob hi')
    expect((await post()).blueskyCrosspost).toBeUndefined()
  })

  it('warns that a long post is cut on Bluesky, without blocking Post', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox()

    type('a'.repeat(300))
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()

    type('a'.repeat(301))
    expect(screen.getByText(BLUESKY_CROSSPOST_CUT_MESSAGE)).toHaveClass(
      'text-warning-text'
    )
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()

    // Off for this post: nothing is cut.
    fireEvent.click((await crosspostItem()) as HTMLElement)
    closeMenu()
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()
  })

  it('does not warn for a long post that is not public', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    await renderPostBox()
    await chooseVisibility(/unlisted/i)
    type('a'.repeat(301))
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()
  })

  it('reopens a draft with the switch as it was saved', async () => {
    setLinkedBlueskyAccount(profile.id, linkedAccount(true))
    const draft: DraftRecord = {
      id: 'draft-crosspost-off',
      accountId: 'account-1',
      actorId: profile.id,
      revision: 1,
      createdAt: currentTime,
      updatedAt: currentTime,
      composer: 'post-box',
      text: 'Saved without Bluesky',
      contentWarning: '',
      contentWarningVisible: false,
      visibility: 'public',
      quoteApprovalPolicy: 'public',
      blueskyCrosspost: false,
      attachments: []
    }
    await renderPostBox({ draft })
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue('Saved without Bluesky')
    )

    expect(await crosspostItem()).toHaveAttribute('aria-checked', 'false')
    closeMenu()
    expect(await post()).toMatchObject({ blueskyCrosspost: false })
  })

  it('says edits stay here when editing a post that went to Bluesky', async () => {
    const posted: EditableStatus = {
      ...editStatus,
      blueskyCrosspost: {
        state: 'posted',
        url: 'https://bsky.app/profile/did:plc:me/post/3k',
        error: null
      }
    }
    await renderPostBox({ editStatus: posted })
    expect(
      screen.getByText('Edits are not sent to Bluesky.')
    ).toBeInTheDocument()
    cleanup()

    await renderPostBox({
      editStatus: {
        ...editStatus,
        blueskyCrosspost: { state: 'failed', url: null, error: 'Nope' }
      }
    })
    expect(
      screen.queryByText('Edits are not sent to Bluesky.')
    ).not.toBeInTheDocument()
  })
})
