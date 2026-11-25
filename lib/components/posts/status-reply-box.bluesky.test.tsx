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

import { createNote, uploadAttachment } from '@/lib/client'
import { getBlueskyAccount } from '@/lib/client/blueskyAccount'
import type { DraftRecord } from '@/lib/client/drafts'
import { ApiRequestError } from '@/lib/client/http'
import {
  resetBlueskyAccountStore,
  setLinkedBlueskyAccount
} from '@/lib/components/bluesky/blueskyAccountStore'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import * as useComposerDraftModule from '@/lib/components/post-box/useComposerDraft'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import {
  BLUESKY_CROSSPOST_CUT_MESSAGE,
  BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE,
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
      syncError: null,
      crosspostByDefault: true
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

  it('does not lock the draft on 409 so the user can edit and press Post again', async () => {
    vi.mocked(createNote).mockRejectedValueOnce(
      new ApiRequestError('Another Bluesky reply is already in progress.', 409)
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
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.change(textarea, { target: { value: 'First try' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(
        screen.getByText('Another Bluesky reply is already in progress.')
      ).toBeInTheDocument()
    })
    expect(textarea).not.toHaveAttribute('readonly')
    expect(postButton).toBeEnabled()
    expect(
      screen.queryByText(/Your post is still being sent/i)
    ).not.toBeInTheDocument()

    vi.mocked(createNote).mockResolvedValueOnce({
      status: {
        ...blueskyStatus,
        id: 'https://bsky.app/profile/did:plc:viewer/post/3kretry409'
      },
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Edited after 409' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Edited after 409' })
      )
    })
  })

  it('does not lock the draft on a 503 with a different error message', async () => {
    vi.mocked(createNote).mockRejectedValueOnce(
      new ApiRequestError('Service Unavailable', 503)
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
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.change(textarea, { target: { value: 'Try before 503' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(screen.getByText('Service Unavailable')).toBeInTheDocument()
    })
    expect(
      screen.queryByText(BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/Your post was saved/i)).not.toBeInTheDocument()
    expect(textarea).not.toHaveAttribute('readonly')
    expect(postButton).toBeEnabled()

    vi.mocked(createNote).mockResolvedValueOnce({
      status: {
        ...blueskyStatus,
        id: 'https://bsky.app/profile/did:plc:viewer/post/3kretry503'
      },
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Edited after 503' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNote).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Edited after 503' })
      )
    })
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

  it('blocks submit and keeps draft and attachments when a Bluesky reply is restored with media', async () => {
    const file = new File(['img-bytes'], 'photo.png', { type: 'image/png' })
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:draft-photo')
    URL.revokeObjectURL = vi.fn()
    const loadFilesSpy = vi
      .spyOn(useComposerDraftModule, 'loadDraftFiles')
      .mockResolvedValue(
        new Map([['local-1', { file, mimeType: 'image/png' }]])
      )

    const draftWithAttachment: DraftRecord = {
      id: 'draft-bsky-media',
      accountId: 'account-1',
      actorId: viewerProfile.id,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      composer: 'reply-box',
      text: 'Reply with restored image',
      contentWarning: '',
      contentWarningVisible: false,
      visibility: 'public',
      quoteApprovalPolicy: 'public',
      replyTo: blueskyStatus,
      attachments: [
        {
          localId: 'local-1',
          owned: true,
          mediaType: 'image/png',
          fileName: 'photo.png',
          description: 'A photo',
          decorative: false,
          hasBlob: true
        }
      ]
    }

    try {
      const { container } = render(
        <InstanceLimitsProvider maxStatusCharacters={500}>
          <StatusReplyBox
            profile={viewerProfile}
            replyStatus={blueskyStatus}
            draft={draftWithAttachment}
            isMediaUploadEnabled
            onCancel={vi.fn()}
            onPostCreated={vi.fn()}
          />
        </InstanceLimitsProvider>
      )

      await waitFor(() => {
        expect(
          screen.getByText(BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE)
        ).toBeInTheDocument()
      })
      const postButton = screen.getByRole('button', { name: 'Post' })
      expect(postButton).toBeDisabled()

      // Even a direct form submit or Ctrl+Enter must not upload or post, and keeps text + attachment.
      const form = container.querySelector('form') as HTMLFormElement
      fireEvent.submit(form)
      fireEvent.keyDown(screen.getByRole('textbox'), {
        ctrlKey: true,
        code: 'Enter'
      })

      expect(uploadAttachment).not.toHaveBeenCalled()
      expect(createNote).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue(
        'Reply with restored image'
      )

      // Removing the attachment clears the error and lets the user post.
      const attachmentTile = container.querySelector(
        '[style*="blob:draft-photo"]'
      ) as HTMLElement
      expect(attachmentTile).not.toBeNull()
      fireEvent.click(attachmentTile)

      expect(
        screen.queryByText(BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE)
      ).not.toBeInTheDocument()
      expect(postButton).toBeEnabled()

      vi.mocked(createNote).mockResolvedValueOnce({
        status: {
          ...blueskyStatus,
          id: 'https://bsky.app/profile/did:plc:viewer/post/3kafterremove'
        },
        attachments: []
      })
      fireEvent.click(postButton)
      await waitFor(() => {
        expect(createNote).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Reply with restored image',
            attachments: []
          })
        )
      })
      expect(uploadAttachment).not.toHaveBeenCalled()
    } finally {
      loadFilesSpy.mockRestore()
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    }
  })
})

const linkedCrosspostAccount = (crosspostByDefault = true) => ({
  did: 'did:plc:viewer1234567890abcdef',
  handle: 'viewer.bsky.social',
  pdsUrl: 'https://bsky.social',
  authType: 'oauth' as const,
  domainHandle: false,
  sessionActive: true,
  lastSyncedAt: null,
  syncError: null,
  crosspostByDefault
})

const ownPublicStatus: StatusNote = {
  ...blueskyStatus,
  id: 'https://activities.local/users/llun/statuses/own-1',
  actorId: viewerProfile.id,
  actor: viewerProfile,
  isLocalActor: true,
  network: undefined,
  url: 'https://activities.local/@llun/own-1',
  text: '<p>My own post</p>',
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: []
}

const ownUnlistedStatus: StatusNote = {
  ...ownPublicStatus,
  id: 'https://activities.local/users/llun/statuses/own-unlisted',
  url: 'https://activities.local/@llun/own-unlisted',
  to: ['https://activities.local/users/llun/followers'],
  cc: [ACTIVITY_STREAM_PUBLIC]
}

const otherActor: ActorProfile = {
  ...viewerProfile,
  id: 'https://other.example/users/bob',
  username: 'bob',
  domain: 'other.example',
  name: 'Bob'
}

const othersStatus: StatusNote = {
  ...ownPublicStatus,
  id: 'https://other.example/users/bob/statuses/1',
  actorId: otherActor.id,
  actor: otherActor,
  isLocalActor: false,
  url: 'https://other.example/@bob/1',
  text: '<p>Someone else’s post</p>'
}

describe('StatusReplyBox cross-posting self-replies to Bluesky', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetBlueskyAccountStore()
    vi.mocked(getBlueskyAccount).mockResolvedValue(null)
    vi.mocked(useConnectionStatus).mockReturnValue({ state: 'online' } as never)
    vi.mocked(useDrafts).mockReturnValue(null)
    vi.mocked(createNote).mockResolvedValue({
      status: {
        ...ownPublicStatus,
        id: 'https://activities.local/users/llun/statuses/reply-new'
      },
      attachments: []
    })
  })

  afterEach(() => {
    cleanup()
    resetBlueskyAccountStore()
  })

  it('loads the linked account for a self-reply, defaults to crosspostByDefault, and omits blueskyCrosspost until flipped', async () => {
    vi.mocked(getBlueskyAccount).mockResolvedValue({
      oauthAvailable: true,
      account: linkedCrosspostAccount(true),
      instanceHandle: null
    })

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    await waitFor(() => expect(getBlueskyAccount).toHaveBeenCalled())
    const toggle = await screen.findByRole('switch', {
      name: 'Also post to Bluesky'
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Continuing my thread' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1))
    expect(
      vi.mocked(createNote).mock.calls[0][0].blueskyCrosspost
    ).toBeUndefined()
  })

  it('keeps the same Idempotency-Key when the account loads between retry attempts and sends explicit choice once flipped', async () => {
    let resolveAccount: (value: unknown) => void = () => undefined
    vi.mocked(getBlueskyAccount).mockReturnValue(
      new Promise((resolve) => {
        resolveAccount = resolve
      }) as never
    )
    vi.mocked(createNote)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        status: {
          ...ownPublicStatus,
          id: 'https://activities.local/users/llun/statuses/reply-new'
        },
        attachments: []
      })

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Retry self-reply' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1))

    // Account arrives between first and second attempt: fingerprint stays the same.
    resolveAccount({
      oauthAvailable: true,
      account: linkedCrosspostAccount(true),
      instanceHandle: null
    })
    const toggle = await screen.findByRole('switch', {
      name: 'Also post to Bluesky'
    })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(2))
    expect(vi.mocked(createNote).mock.calls[1][0].idempotencyKey).toBe(
      vi.mocked(createNote).mock.calls[0][0].idempotencyKey
    )
    expect(
      vi.mocked(createNote).mock.calls[1][0].blueskyCrosspost
    ).toBeUndefined()

    // Flipping the switch changes the fingerprint (new key) and sends false.
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(3))
    expect(vi.mocked(createNote).mock.calls[2][0].blueskyCrosspost).toBe(false)
    expect(vi.mocked(createNote).mock.calls[2][0].idempotencyKey).not.toBe(
      vi.mocked(createNote).mock.calls[1][0].idempotencyKey
    )
  })

  it('starts off when crosspostByDefault is false and sends true once flipped on', async () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(false))

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const toggle = screen.getByRole('switch', { name: 'Also post to Bluesky' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Opt-in reply' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createNote).mock.calls[0][0]).toMatchObject({
      blueskyCrosspost: true
    })
  })

  it('offers the switch on a self-reply only when the parent has a live Bluesky copy', () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(true))

    const renderReply = (blueskyCrosspost: StatusNote['blueskyCrosspost']) =>
      render(
        <InstanceLimitsProvider maxStatusCharacters={5000}>
          <StatusReplyBox
            profile={viewerProfile}
            replyStatus={{ ...ownPublicStatus, blueskyCrosspost }}
            onCancel={vi.fn()}
            onPostCreated={vi.fn()}
          />
        </InstanceLimitsProvider>
      )

    // No copy row: the server would post nothing, so no switch.
    renderReply(null)
    expect(
      screen.queryByRole('switch', { name: 'Also post to Bluesky' })
    ).not.toBeInTheDocument()
    cleanup()

    // A failed copy is not continued either.
    renderReply({ state: 'failed', url: null, error: 'Nope' })
    expect(
      screen.queryByRole('switch', { name: 'Also post to Bluesky' })
    ).not.toBeInTheDocument()
    cleanup()

    // A posted copy continues the thread.
    renderReply({
      state: 'posted',
      url: 'https://bsky.app/profile/did:plc:viewer/post/3k',
      error: null
    })
    expect(
      screen.getByRole('switch', { name: 'Also post to Bluesky' })
    ).toBeInTheDocument()
  })

  it('does not show the switch for replies to other people, Bluesky posts, or when unlinked', () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(true))

    const { rerender } = render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={othersStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    expect(
      screen.queryByRole('switch', { name: 'Also post to Bluesky' })
    ).not.toBeInTheDocument()

    rerender(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={blueskyStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    expect(
      screen.queryByRole('switch', { name: 'Also post to Bluesky' })
    ).not.toBeInTheDocument()

    setLinkedBlueskyAccount(viewerProfile.id, null)
    rerender(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    expect(
      screen.queryByRole('switch', { name: 'Also post to Bluesky' })
    ).not.toBeInTheDocument()
  })

  it('disables the switch with the public-only reason and hides the cut warning on a non-public self-reply', () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(true))

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownUnlistedStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const toggle = screen.getByRole('switch', { name: 'Also post to Bluesky' })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAccessibleDescription(
      'Only public posts go to Bluesky.'
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'a'.repeat(350) }
    })
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()
  })

  it('warns when a cross-posted self-reply exceeds Bluesky limits and honors content warnings', () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(true))

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'a'.repeat(300) } })
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()

    fireEvent.change(textarea, { target: { value: 'a'.repeat(301) } })
    expect(screen.getByText(BLUESKY_CROSSPOST_CUT_MESSAGE)).toHaveClass(
      'text-warning-text'
    )
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()

    // Non-empty short content warning replaces the body on Bluesky: no cut warning.
    fireEvent.click(screen.getByRole('button', { name: 'Add content warning' }))
    const cwInput = screen.getByRole('textbox', { name: 'Content warning' })
    fireEvent.change(cwInput, { target: { value: 'Spoilers' } })
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()

    // Long content warning plus post link exceeds 300 even with a short body.
    fireEvent.change(textarea, { target: { value: 'Short reply' } })
    fireEvent.change(cwInput, { target: { value: 'w'.repeat(260) } })
    expect(screen.getByText(BLUESKY_CROSSPOST_CUT_MESSAGE)).toBeInTheDocument()

    // Turning cross-post off clears the warning.
    fireEvent.click(
      screen.getByRole('switch', { name: 'Also post to Bluesky' })
    )
    expect(
      screen.queryByText(BLUESKY_CROSSPOST_CUT_MESSAGE)
    ).not.toBeInTheDocument()
  })

  it('reopens a reply draft with its saved blueskyCrosspost state', async () => {
    setLinkedBlueskyAccount(viewerProfile.id, linkedCrosspostAccount(true))
    const savedDraft: DraftRecord = {
      id: 'draft-reply-crosspost-off',
      accountId: 'account-1',
      actorId: viewerProfile.id,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      composer: 'reply-box',
      text: 'Saved self-reply without Bluesky',
      contentWarning: '',
      contentWarningVisible: false,
      visibility: 'public',
      quoteApprovalPolicy: 'public',
      blueskyCrosspost: false,
      replyTo: ownPublicStatus,
      attachments: []
    }

    render(
      <InstanceLimitsProvider maxStatusCharacters={5000}>
        <StatusReplyBox
          profile={viewerProfile}
          replyStatus={ownPublicStatus}
          draft={savedDraft}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const toggle = screen.getByRole('switch', { name: 'Also post to Bluesky' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1))
    expect(vi.mocked(createNote).mock.calls[0][0]).toMatchObject({
      blueskyCrosspost: false
    })
  })
})
