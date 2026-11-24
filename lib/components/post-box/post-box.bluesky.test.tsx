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
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { BLUESKY_TOO_LONG_MESSAGE } from '@/lib/utils/blueskyText'

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

const renderPostBox = async () => {
  const result = render(
    <InstanceLimitsProvider maxStatusCharacters={500}>
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

    await renderPostBox()

    await waitFor(() => {
      expect(
        screen.getByText('Replying on Bluesky as me.bsky.social · public')
      ).toBeInTheDocument()
    })
    // Counts to 300 instead of the 500 instance limit.
    expect(screen.getByText('300')).toBeInTheDocument()

    const textarea = screen.getByRole('textbox')
    // Does not prefill a Fediverse @user@bsky.app mention.
    expect(textarea).toHaveValue('')

    // 300 ZWJ family emoji = 300 graphemes (3300 UTF-16 code units) -> still 0 remaining and allowed.
    fireEvent.change(textarea, {
      target: { value: '👨‍👩‍👧‍👦'.repeat(300) }
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
})
