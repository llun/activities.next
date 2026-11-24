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

import { uploadAttachment } from '@/lib/client'
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
  BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE,
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

  it('does not lock the draft on 409 so the user can edit and press Post again', async () => {
    createNoteMock.mockRejectedValueOnce(
      new ApiRequestError('Another Bluesky reply is already in progress.', 409)
    )

    await renderPostBox()

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

    createNoteMock.mockResolvedValueOnce({
      status: {
        ...blueskyReplyTarget,
        id: 'https://bsky.app/profile/did:plc:me/post/3kretry409'
      },
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Edited after 409' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Edited after 409' })
      )
    })
  })

  it('does not lock the draft on a 503 with a different error message', async () => {
    createNoteMock.mockRejectedValueOnce(
      new ApiRequestError('Service Unavailable', 503)
    )

    await renderPostBox()

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

    createNoteMock.mockResolvedValueOnce({
      status: {
        ...blueskyReplyTarget,
        id: 'https://bsky.app/profile/did:plc:me/post/3kretry503'
      },
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Edited after 503' } })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ message: 'Edited after 503' })
      )
    })
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

  it('blocks submit and does not upload or drop attachments when a Bluesky reply draft carries media', async () => {
    const file = new File(['img-bytes'], 'draft-photo.png', {
      type: 'image/png'
    })
    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:postbox-draft-photo')
    URL.revokeObjectURL = vi.fn()
    const loadFilesSpy = vi
      .spyOn(useComposerDraftModule, 'loadDraftFiles')
      .mockResolvedValue(
        new Map([['local-pb-1', { file, mimeType: 'image/png' }]])
      )

    const draftWithAttachment: DraftRecord = {
      id: 'draft-postbox-bsky-media',
      accountId: 'account-1',
      actorId: profile.id,
      revision: 1,
      createdAt: currentTime,
      updatedAt: currentTime,
      composer: 'post-box',
      text: 'PostBox Bluesky reply with photo',
      contentWarning: '',
      contentWarningVisible: false,
      visibility: 'public',
      quoteApprovalPolicy: 'public',
      replyTo: blueskyReplyTarget,
      attachments: [
        {
          localId: 'local-pb-1',
          owned: true,
          mediaType: 'image/png',
          fileName: 'draft-photo.png',
          description: '',
          decorative: false,
          hasBlob: true
        }
      ]
    }

    try {
      const { container } = render(
        <InstanceLimitsProvider maxStatusCharacters={500}>
          <PostBox
            host="activities.local"
            profile={profile}
            replyStatus={blueskyReplyTarget}
            draft={draftWithAttachment}
            isMediaUploadEnabled
            onDiscardReply={vi.fn()}
            onPostCreated={vi.fn()}
            onPostUpdated={vi.fn()}
            onDiscardEdit={vi.fn()}
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
      // Restoring a Bluesky reply draft must not start uploading its attachment.
      expect(uploadAttachment).not.toHaveBeenCalled()

      // Direct form submit and Ctrl+Enter are blocked without uploading or posting.
      const form = container.querySelector('form') as HTMLFormElement
      fireEvent.submit(form)
      fireEvent.keyDown(screen.getByRole('textbox'), {
        ctrlKey: true,
        code: 'Enter'
      })
      expect(uploadAttachment).not.toHaveBeenCalled()
      expect(createNoteMock).not.toHaveBeenCalled()
      expect(screen.getByRole('textbox')).toHaveValue(
        'PostBox Bluesky reply with photo'
      )

      // Removing the attachment clears the warning and lets the reply post.
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media draft-photo.png' })
      )
      expect(
        screen.queryByText(BLUESKY_REPLY_ATTACHMENTS_BLOCKED_MESSAGE)
      ).not.toBeInTheDocument()
      expect(postButton).toBeEnabled()

      createNoteMock.mockResolvedValueOnce({
        status: {
          ...blueskyReplyTarget,
          id: 'https://bsky.app/profile/did:plc:me/post/3kpostboxok'
        },
        attachments: []
      })
      fireEvent.click(postButton)
      await waitFor(() => {
        expect(createNoteMock).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'PostBox Bluesky reply with photo',
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
