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
import { ApiRequestError } from '@/lib/client/http'
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE,
  BLUESKY_REPLY_QUEUE_DISABLED_REASON,
  BLUESKY_TOO_LONG_MESSAGE
} from '@/lib/utils/blueskyText'

import { PostBox } from './post-box'
import { createNoteMock, currentTime, profile } from './post-box.testUtils'

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

const blueskyAuthor: ActorProfile = {
  ...profile,
  id: 'https://bsky.app/profile/did:plc:parentauthor1234567890ab',
  username: 'parent.bsky.social',
  domain: 'bsky.app',
  name: 'Parent'
}

const blueskyReplyTarget: StatusNote = {
  id: `${blueskyAuthor.id}/post/3kparent`,
  actorId: blueskyAuthor.id,
  actor: blueskyAuthor,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  isLocalActor: false,
  network: 'bluesky',
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: `${blueskyAuthor.id}/post/3kparent`,
  text: '<p>Hello Bluesky</p>',
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

const renderPostBox = async (maxStatusCharacters = 500) => {
  const result = render(
    <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
      <PostBox
        host="activities.local"
        profile={profile}
        replyStatus={blueskyReplyTarget}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    </InstanceLimitsProvider>
  )
  await act(async () => {
    await Promise.resolve()
  })
  return result
}

describe('PostBox replying to a Bluesky post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBlueskyAccountStore()
    vi.mocked(getBlueskyAccount).mockResolvedValue(null)
    vi.mocked(useConnectionStatus).mockReturnValue({ state: 'online' } as never)
    vi.mocked(useDrafts).mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    resetBlueskyAccountStore()
  })

  it('shows the Bluesky reply note with linked handle when loaded and counts to 300 graphemes', async () => {
    vi.mocked(getBlueskyAccount).mockResolvedValue({
      oauthAvailable: true,
      account: {
        did: 'did:plc:me1234567890abcdefghijkl',
        handle: 'me.bsky.social',
        pdsUrl: 'https://bsky.social',
        authType: 'oauth',
        domainHandle: false,
        sessionActive: true,
        lastSyncedAt: null,
        syncError: null
      },
      instanceHandle: null
    })

    await renderPostBox(1000)

    await waitFor(() => {
      expect(
        screen.getByText('Replying on Bluesky as me.bsky.social · public')
      ).toBeInTheDocument()
    })
    // Counts to 300 instead of the 1000 instance limit.
    expect(screen.getByText('300')).toBeInTheDocument()

    const textarea = screen.getByRole('textbox')
    // Does not prefill a Fediverse @user@bsky.app mention.
    expect(textarea).toHaveValue('')

    // 300 emoji = 300 graphemes (600 UTF-16 code units <= 1000, 1200 UTF-8 bytes <= 3000) -> still 0 remaining and allowed.
    fireEvent.change(textarea, {
      target: { value: '🚀'.repeat(300) }
    })
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })

  it('shows the fallback note without handle when no linked account is loaded', async () => {
    await renderPostBox()

    expect(screen.getByText('Replying on Bluesky · public')).toBeInTheDocument()
  })

  it('shows warning text next to a negative count and disables Post over 300 graphemes', async () => {
    setLinkedBlueskyAccount(profile.id, {
      did: 'did:plc:me1234567890abcdefghijkl',
      handle: 'me.bsky.social',
      pdsUrl: 'https://bsky.social',
      authType: 'oauth',
      domainHandle: false,
      sessionActive: true,
      lastSyncedAt: null,
      syncError: null
    })

    await renderPostBox()

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'a'.repeat(301) } })

    const warning = screen.getByText(BLUESKY_TOO_LONG_MESSAGE)
    expect(warning).toBeInTheDocument()
    expect(warning).toHaveClass('text-warning-text')
    const counter = screen.getByText('-1')
    expect(counter).toHaveClass('text-warning-text')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('disables media, locks visibility to public, and disables poll and content warning with reasons', async () => {
    await renderPostBox()

    const mediaButton = screen.getByRole('button', {
      name: /Images in Bluesky replies are not supported yet\./i
    })
    expect(mediaButton).toBeDisabled()

    fireEvent.keyDown(screen.getByRole('button', { name: 'Post options' }), {
      key: 'ArrowDown'
    })
    await screen.findByRole('menu')

    const pollItem = screen.getByRole('menuitemcheckbox', { name: 'Poll' })
    expect(pollItem).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getAllByText('Not supported on Bluesky replies')
    ).toHaveLength(2)

    const cwItem = screen.getByRole('menuitemcheckbox', {
      name: 'Content warning'
    })
    expect(cwItem).toHaveAttribute('aria-disabled', 'true')

    expect(screen.getByText('Bluesky replies are public')).toBeInTheDocument()
    const visibilityItem = screen.getByRole('menuitem', {
      name: /Visibility.*Public/i
    })
    expect(visibilityItem).toHaveAttribute('aria-disabled', 'true')
  })

  it('submits the Bluesky reply with public visibility', async () => {
    createNoteMock.mockResolvedValue({
      status: {
        ...blueskyReplyTarget,
        id: 'https://bsky.app/profile/did:plc:me/post/3knew'
      },
      attachments: []
    })

    await renderPostBox()

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Nice post!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Nice post!',
          visibility: 'public',
          contentWarning: '',
          attachments: [],
          replyStatus: blueskyReplyTarget
        })
      )
    })
  })

  it('enforces the instance .length limit alongside the 300-grapheme limit and shows the matching message', async () => {
    // 1) Instance limit < 300: 201 ASCII chars hits the instance limit.
    const first = await renderPostBox(200)
    expect(screen.getByText('200')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'a'.repeat(201) }
    })
    expect(
      screen.getByText('Text character limit of 200 exceeded')
    ).toBeInTheDocument()
    expect(screen.getByText('-1')).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    first.unmount()

    // 2) Within 300 graphemes (50 ZWJ emoji) but over 500 UTF-16 code units (550).
    await renderPostBox(500)
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '👨‍👩‍👧‍👦'.repeat(50) }
    })
    expect(
      screen.getByText('Text character limit of 500 exceeded')
    ).toBeInTheDocument()
    expect(screen.getByText('-50')).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('locks the draft with the posted-not-stored message on 503 and does not offer to resend', async () => {
    createNoteMock.mockRejectedValueOnce(
      new ApiRequestError(BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE, 503)
    )

    await renderPostBox()

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Sent to Bluesky' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(
        screen.getByText(BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE)
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByText(/Press Post again to retry/i)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Editing is locked until it is sent/i)
    ).not.toBeInTheDocument()
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument()
  })

  it('disables Send when online when offline with the Bluesky reply reason', async () => {
    vi.mocked(useConnectionStatus).mockReturnValue({
      state: 'offline'
    } as never)
    vi.mocked(useDrafts).mockReturnValue({
      accountId: 'account-1',
      actorId: profile.id,
      count: 0,
      available: true,
      refresh: vi.fn()
    } as never)

    await renderPostBox()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Offline Bluesky reply' }
    })

    const queueButton = screen.getByRole('button', { name: 'Send when online' })
    expect(queueButton).toHaveAttribute('aria-disabled', 'true')
    expect(queueButton).toHaveAccessibleDescription(
      BLUESKY_REPLY_QUEUE_DISABLED_REASON
    )
    expect(
      screen.getByText(BLUESKY_REPLY_QUEUE_DISABLED_REASON)
    ).toBeInTheDocument()
  })
})
