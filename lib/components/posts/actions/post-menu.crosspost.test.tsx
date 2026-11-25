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

import {
  getStatusById,
  retryBlueskyCrosspost,
  updateStatusVisibility
} from '@/lib/client'
import { ApiRequestError } from '@/lib/client/http'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
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
  retryBlueskyCrosspost: vi.fn(),
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

const VIEWER_ID = 'https://activities.local/users/llun'
const now = new Date('2026-11-24T07:00:00.000Z').getTime()
const BSKY_URL = 'https://bsky.app/profile/did:plc:me/post/3kabc'

const ownPost = (
  blueskyCrosspost: StatusNote['blueskyCrosspost']
): StatusNote => ({
  id: `${VIEWER_ID}/statuses/post-1`,
  actorId: VIEWER_ID,
  actor: null,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: now,
  updatedAt: now,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: '<p>Hello</p>',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  blueskyCrosspost
})

const renderMenu = async (
  blueskyCrosspost: StatusNote['blueskyCrosspost'],
  isOwner = true
) => {
  render(
    <PostMenu
      status={ownPost(blueskyCrosspost)}
      isOwner={isOwner}
      canEdit
      viewerId={VIEWER_ID}
    />
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('PostMenu Bluesky cross-post', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('links to the Bluesky copy of a posted cross-post in a new tab', async () => {
    await renderMenu({ state: 'posted', url: BSKY_URL, error: null })
    const item = screen.getByRole('menuitem', { name: 'View on Bluesky' })
    expect(item).toHaveAttribute('href', BSKY_URL)
    expect(item).toHaveAttribute('target', '_blank')
    expect(item).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('shows a disabled line while the cross-post is pending', async () => {
    await renderMenu({ state: 'pending', url: null, error: null })
    expect(
      screen.getByRole('menuitem', { name: 'Posting to Bluesky…' })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  it('shows why a cross-post failed and retries it', async () => {
    vi.mocked(retryBlueskyCrosspost).mockResolvedValue({
      state: 'pending',
      url: null,
      error: null
    })
    await renderMenu({ state: 'failed', url: null, error: 'Bluesky is down' })
    expect(
      screen.getByText('Not posted to Bluesky: Bluesky is down')
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Retry posting to Bluesky' })
    )
    expect(retryBlueskyCrosspost).toHaveBeenCalledWith(
      `${VIEWER_ID}/statuses/post-1`
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Posting to Bluesky…' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/Not posted to Bluesky/)).not.toBeInTheDocument()
  })

  it('shows Retrying… and then the error when a retry fails', async () => {
    let reject: (error: unknown) => void = () => {}
    vi.mocked(retryBlueskyCrosspost).mockImplementation(
      () =>
        new Promise((_resolve, rejectRetry) => {
          reject = rejectRetry
        })
    )
    await renderMenu({ state: 'failed', url: null, error: null })
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Retry posting to Bluesky' })
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Retrying…' })
    ).toHaveAttribute('aria-disabled', 'true')

    reject(new ApiRequestError('Link your Bluesky account again.', 422))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Link your Bluesky account again.'
    )
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Retry posting to Bluesky' })
      ).not.toHaveAttribute('aria-disabled')
    )
  })

  it('shows nothing about Bluesky on a post that was not cross-posted, or to others', async () => {
    await renderMenu(null)
    expect(screen.queryByText(/Bluesky/)).not.toBeInTheDocument()
    cleanup()

    await renderMenu({ state: 'posted', url: BSKY_URL, error: null }, false)
    expect(screen.queryByText(/Bluesky/)).not.toBeInTheDocument()
  })

  it('refreshes cross-post state from getStatusById on open and clears it on null', async () => {
    vi.mocked(getStatusById).mockResolvedValueOnce({
      id: `${VIEWER_ID}/statuses/post-1`,
      pinned: false,
      bluesky_crosspost: { state: 'posted', url: BSKY_URL, error: null }
    } as MastodonStatus)

    await renderMenu({ state: 'pending', url: null, error: null })
    expect(
      await screen.findByRole('menuitem', { name: 'View on Bluesky' })
    ).toHaveAttribute('href', BSKY_URL)
    cleanup()

    vi.mocked(getStatusById).mockResolvedValueOnce({
      id: `${VIEWER_ID}/statuses/post-1`,
      pinned: false,
      bluesky_crosspost: null
    } as MastodonStatus)

    await renderMenu({ state: 'posted', url: BSKY_URL, error: null })
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitem', { name: 'View on Bluesky' })
      ).not.toBeInTheDocument()
    )
  })

  it('clears the cross-post state after narrowing visibility away from public', async () => {
    vi.mocked(updateStatusVisibility).mockResolvedValueOnce(false)
    await renderMenu({ state: 'posted', url: BSKY_URL, error: null })
    expect(
      screen.getByRole('menuitem', { name: 'View on Bluesky' })
    ).toBeInTheDocument()

    // Failed visibility narrowing keeps the cross-post item intact.
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Change visibility' }),
      { key: 'ArrowRight' }
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unlisted' }))
    await waitFor(() =>
      expect(updateStatusVisibility).toHaveBeenCalledWith({
        statusId: `${VIEWER_ID}/statuses/post-1`,
        visibility: 'unlisted'
      })
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
      key: 'ArrowDown'
    })
    await screen.findByRole('menu')
    expect(
      screen.getByRole('menuitem', { name: 'View on Bluesky' })
    ).toBeInTheDocument()

    // Successful visibility narrowing away from public clears the cross-post item.
    vi.mocked(updateStatusVisibility).mockResolvedValueOnce(true)
    fireEvent.keyDown(
      screen.getByRole('menuitem', { name: 'Change visibility' }),
      { key: 'ArrowRight' }
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unlisted' }))
    await waitFor(() => expect(updateStatusVisibility).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
      key: 'ArrowDown'
    })
    await screen.findByRole('menu')
    expect(screen.queryByText(/Bluesky/)).not.toBeInTheDocument()
  })
})
