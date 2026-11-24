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

import { deleteStatus } from '@/lib/client'
import { getBlueskyAccount } from '@/lib/client/blueskyAccount'
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { PostMenu } from './post-menu'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  getRelationship: vi.fn().mockResolvedValue(null),
  getStatusById: vi.fn().mockResolvedValue(null),
  getBookmarkFolders: vi.fn().mockResolvedValue([]),
  pinStatus: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  unpinStatus: vi.fn().mockResolvedValue({ ok: true, status: 200 }),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  deleteStatus: vi.fn().mockResolvedValue(true),
  setStatusBookmarkFolder: vi.fn(),
  updateStatusVisibility: vi.fn(),
  updateStatusInteractionPolicy: vi.fn()
}))

vi.mock('@/lib/client/blueskyAccount', () => ({
  getBlueskyAccount: vi.fn().mockResolvedValue(null)
}))

const VIEWER_ID = 'https://activities.local/users/llun'
const OWN_DID = 'did:plc:ownbsky1234567890abcdefg'
const OTHER_DID = 'did:plc:otherbsky1234567890abcde'
const now = new Date('2026-11-24T07:00:00.000Z').getTime()

const makeBlueskyStatus = (did: string, handle: string): StatusNote => {
  const actorId = `https://bsky.app/profile/${did}`
  const actor: ActorProfile = {
    id: actorId,
    username: handle,
    domain: 'bsky.app',
    name: handle,
    followersUrl: `${actorId}/followers`,
    inboxUrl: `${actorId}/inbox`,
    sharedInboxUrl: 'https://bsky.app/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: now
  }
  return {
    id: `${actorId}/post/3kpost1`,
    actorId,
    actor,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [],
    edits: [],
    isLocalActor: false,
    network: 'bluesky',
    createdAt: now,
    updatedAt: now,
    type: StatusType.enum.Note,
    url: `${actorId}/post/3kpost1`,
    text: '<p>Bluesky post</p>',
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
}

const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('PostMenu for Bluesky posts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBlueskyAccountStore()
    vi.mocked(getBlueskyAccount).mockResolvedValue(null)
  })

  afterEach(() => {
    cleanup()
    resetBlueskyAccountStore()
  })

  it('shows Delete post and hides Edit, Mute, Block, and Report for the viewer own Bluesky post', async () => {
    const ownBlueskyStatus = makeBlueskyStatus(OWN_DID, 'me.bsky.social')
    vi.mocked(getBlueskyAccount).mockResolvedValue({
      oauthAvailable: true,
      account: {
        did: OWN_DID,
        handle: 'me.bsky.social',
        pdsUrl: 'https://bsky.social',
        authType: 'oauth',
        domainHandle: false,
        sessionActive: true,
        lastSyncedAt: null,
        syncError: null,
        crosspostByDefault: true
      },
      instanceHandle: null
    })
    const onPostDeleted = vi.fn()

    render(
      <PostMenu
        status={ownBlueskyStatus}
        isOwner={false}
        canEdit={false}
        viewerId={VIEWER_ID}
        onPostDeleted={onPostDeleted}
      />
    )

    await openMenu()

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: 'Delete post' })
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('menuitem', { name: 'Edit post' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Report post' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /Mute/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /Block/i })
    ).not.toBeInTheDocument()

    // Confirming Delete invokes DELETE /api/v1/statuses/:id via deleteStatus.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteStatus).toHaveBeenCalledWith({
        statusId: ownBlueskyStatus.id
      })
      expect(onPostDeleted).toHaveBeenCalledWith(ownBlueskyStatus)
    })
  })

  it('does not show Delete for another user Bluesky post', async () => {
    const otherBlueskyStatus = makeBlueskyStatus(OTHER_DID, 'other.bsky.social')
    setLinkedBlueskyAccount(VIEWER_ID, {
      did: OWN_DID,
      handle: 'me.bsky.social',
      pdsUrl: 'https://bsky.social',
      authType: 'oauth',
      domainHandle: false,
      sessionActive: true,
      lastSyncedAt: null,
      syncError: null,
      crosspostByDefault: true
    })

    render(
      <PostMenu
        status={otherBlueskyStatus}
        isOwner={false}
        canEdit={false}
        viewerId={VIEWER_ID}
      />
    )

    await openMenu()

    expect(
      screen.queryByRole('menuitem', { name: 'Delete post' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Report post' })
    ).toBeInTheDocument()
  })

  it('hides Edit post on Bluesky posts even when isOwner and canEdit are true', async () => {
    const ownBlueskyStatus = makeBlueskyStatus(OWN_DID, 'me.bsky.social')

    render(
      <PostMenu
        status={ownBlueskyStatus}
        isOwner
        canEdit
        viewerId={VIEWER_ID}
      />
    )

    await openMenu()

    expect(
      screen.queryByRole('menuitem', { name: 'Edit post' })
    ).not.toBeInTheDocument()
  })
})
