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
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { BLUESKY_TOO_LONG_MESSAGE } from '@/lib/utils/blueskyText'

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/client/blueskyAccount', () => ({
  getBlueskyAccount: vi.fn().mockResolvedValue(null)
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
})
