/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'

import { createNote } from '@/lib/client'
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

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/client/blueskyAccount', () => ({
  getBlueskyAccount: vi.fn().mockResolvedValue(null)
}))

vi.mock('@/lib/hooks/useConnectionStatus', () => ({
  useConnectionStatus: vi.fn(() => ({ state: 'online' }))
}))

vi.mock('@/lib/components/drafts/DraftsProvider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useDrafts: vi.fn(() => null)
}))

const now = new Date('2026-11-24T07:00:00.000Z').getTime()

const viewerProfile: ActorProfile = {
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
  createdAt: now
}

const blueskyAuthor: ActorProfile = {
  ...viewerProfile,
  id: 'https://bsky.app/profile/did:plc:parent1234567890abcdefgh',
  username: 'alice.bsky.social',
  domain: 'bsky.app',
  name: 'Alice'
}

const blueskyStatus: StatusNote = {
  id: `${blueskyAuthor.id}/post/3k1`,
  actorId: blueskyAuthor.id,
  actor: blueskyAuthor,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  isLocalActor: false,
  network: 'bluesky',
  createdAt: now,
  updatedAt: now,
  type: StatusType.enum.Note,
  url: `${blueskyAuthor.id}/post/3k1`,
  text: '<p>Hi from Bluesky</p>',
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

describe('StatusReplyBox replying to a Bluesky post', () => {
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

  it('shows Bluesky reply note, 300-grapheme limit, warning over 300, and disables media and CW', async () => {
    setLinkedBlueskyAccount(viewerProfile.id, {
      did: 'did:plc:viewer1234567890abcdef',
      handle: 'viewer.bsky.social',
      pdsUrl: 'https://bsky.social',
      authType: 'oauth',
      domainHandle: false,
      sessionActive: true,
      lastSyncedAt: null,
      syncError: null
    })

    render(
      <InstanceLimitsProvider maxStatusCharacters={500}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    expect(
      screen.getByText('Replying on Bluesky as viewer.bsky.social · public')
    ).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('')

    expect(
      screen.getByRole('button', {
        name: /Content warnings are not supported on Bluesky replies/i
      })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: /Images in Bluesky replies are not supported yet\./i
      })
    ).toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'x'.repeat(302) } })
    expect(screen.getByText(BLUESKY_TOO_LONG_MESSAGE)).toHaveClass(
      'text-warning-text'
    )
    expect(screen.getByText('-2')).toHaveClass('text-warning-text')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    vi.mocked(createNote).mockResolvedValue({
      status: {
        ...blueskyStatus,
        id: 'https://bsky.app/profile/did:plc:viewer/post/3knew'
      },
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Short reply' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(createNote).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Short reply',
          visibility: 'public',
          inReplyToId: blueskyStatus.id
        })
      )
    })
  })

  it('enforces both the instance .length limit and 300 graphemes and shows whichever message applies', () => {
    const first = render(
      <InstanceLimitsProvider maxStatusCharacters={200}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    expect(screen.getByText('200')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'a'.repeat(201) }
    })
    expect(
      screen.getByText('Text character limit of 200 exceeded')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    first.unmount()

    render(
      <InstanceLimitsProvider maxStatusCharacters={500}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '👨‍👩‍👧‍👦'.repeat(50) }
    })
    expect(
      screen.getByText('Text character limit of 500 exceeded')
    ).toBeInTheDocument()
    expect(screen.getByText('-50')).toHaveClass('text-destructive')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('locks with the posted-not-stored message on 503 and disables Post so it cannot resend', async () => {
    vi.mocked(createNote).mockRejectedValueOnce(
      new ApiRequestError(BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE, 503)
    )

    render(
      <InstanceLimitsProvider maxStatusCharacters={500}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Already on Bluesky' } })
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
  })

  it('disables Send when online while offline with the Bluesky reply reason', () => {
    vi.mocked(useConnectionStatus).mockReturnValue({
      state: 'offline'
    } as never)
    vi.mocked(useDrafts).mockReturnValue({
      accountId: 'account-1',
      actorId: viewerProfile.id,
      count: 0,
      available: true,
      refresh: vi.fn()
    } as never)

    render(
      <InstanceLimitsProvider maxStatusCharacters={500}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Offline reply' }
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
