/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { StrictMode } from 'react'

import { resetConnectionForTesting } from '@/lib/client/connection'
import {
  type DraftRecord,
  fileToBlobRecord,
  getDraft,
  getDraftBlob,
  listDrafts,
  putDraftBlob,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { ApiRequestError } from '@/lib/client/http'
import {
  DraftsProvider,
  useDrafts
} from '@/lib/components/drafts/DraftsProvider'
import { PostBox } from '@/lib/components/post-box/post-box'
import {
  createNoteMock,
  profile,
  resetPostBoxMediaMocks
} from '@/lib/components/post-box/post-box-media.testUtils'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'
import { type Status, StatusType } from '@/lib/types/domain/status'

import { DraftEditor } from './DraftEditor'

// The real composers, not stand-ins: this is the seam where the Drafts page
// hands a stored record to PostBox / StatusReplyBox.
vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  createPoll: vi.fn(),
  deleteFitnessFile: vi.fn(),
  describeMedia: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGalleryGears: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  getMediaAlbums: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

// Passes through; a test can hold the attachment bytes back to keep a reopened
// draft only partly restored.
vi.mock('@/lib/client/drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/drafts')>()
  return { ...actual, getDraftBlob: vi.fn(actual.getDraftBlob) }
})

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

configure({ asyncUtilTimeout: 4000 })

const ACCOUNT_ID = 'account-1'

const replyTarget = {
  id: 'https://activities.local/users/bob/statuses/1',
  actorId: 'https://activities.local/users/bob',
  actor: {
    id: 'https://activities.local/users/bob',
    username: 'bob',
    domain: 'activities.local',
    name: 'Bob'
  },
  type: StatusType.enum.Note,
  text: 'Original',
  summary: null,
  attachments: [],
  tags: [],
  to: [],
  cc: [],
  edits: [],
  replies: [],
  totalLikes: 0,
  totalShares: 0
} as unknown as Status

const record = (patch: Partial<DraftRecord>): DraftRecord => ({
  id: 'draft-1',
  accountId: ACCOUNT_ID,
  actorId: profile.id,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'Stored text',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

// The provider reads the account epoch after mount, and until it has, every
// save is refused ("Drafts are not ready yet"). A test that edits and then
// unmounts or posts straight away loses that save under load, so each tree
// carries this marker and the test waits for it.
const EpochReady = () =>
  useDrafts()?.epoch != null ? <span data-testid="drafts-ready" /> : null

const waitForEpoch = () => screen.findByTestId('drafts-ready')

const open = async (
  draft: DraftRecord,
  { strict = false, bytes }: { strict?: boolean; bytes?: File } = {}
) => {
  await saveDraft({ ...draft, revision: 0 }, { expectedRevision: 0, epoch: 0 })
  if (bytes) {
    await putDraftBlob(
      await fileToBlobRecord({
        id: 'pending-1',
        draftId: draft.id,
        file: bytes
      }),
      { accountId: ACCOUNT_ID, epoch: 0 }
    )
  }
  const stored = (await getDraft(draft.id)) as DraftRecord
  const onClose = vi.fn()
  const tree = (
    <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
      <EpochReady />
      <DraftEditor
        draft={stored}
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        onClose={onClose}
      />
    </DraftsProvider>
  )
  const { unmount } = render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  await waitForEpoch()
  return { stored, onClose, unmount }
}

// A seeded draft enables Post a render after it shows its text (allowPost
// recomputes once the draft lands); a click in between hits a disabled button
// and is lost, which is a flake under load.
const postWhenReady = async () => {
  const button = await screen.findByRole('button', { name: 'Post' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}

describe('DraftEditor with the real composers', () => {
  beforeEach(() => {
    resetPostBoxMediaMocks()
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }))
    )
  })

  afterEach(() => {
    resetConnectionForTesting()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('seeds PostBox from a locked draft, posts it under the stored key and closes', async () => {
    // A real composer writes the draft, so the key and fingerprint are genuine.
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const first = render(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <EpochReady />
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </DraftsProvider>
    )
    await waitForEpoch()
    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'Locked post' }
    })
    await postWhenReady()
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const key = createNoteMock.mock.calls[0][0].idempotencyKey
    await waitFor(async () =>
      expect(
        (await listDrafts({ actorId: profile.id }))[0]?.lockedMessage
      ).toBeDefined()
    )
    first.unmount()
    createNoteMock.mockClear()
    const [stored] = await listDrafts({ actorId: profile.id })

    const onClose = vi.fn()
    render(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <DraftEditor
          draft={stored}
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onClose={onClose}
        />
      </DraftsProvider>
    )

    const textarea = await screen.findByPlaceholderText('What is on your mind?')
    expect(textarea).toHaveValue('Locked post')
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    await postWhenReady()

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    expect(createNoteMock.mock.calls[0][0]).toMatchObject({
      message: 'Locked post',
      idempotencyKey: key
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    await waitFor(async () => expect(await getDraft(stored.id)).toBeUndefined())
  })

  it('seeds StatusReplyBox from a reply draft and closes on send', async () => {
    const { onClose } = await open(
      record({
        composer: 'reply-box',
        text: '@bob@activities.local Reply body',
        replyTo: replyTarget
      })
    )

    const textarea = await screen.findByPlaceholderText(/^Reply to/)
    await waitFor(() =>
      expect(textarea).toHaveValue('@bob@activities.local Reply body')
    )

    await postWhenReady()

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    expect(createNoteMock.mock.calls[0][0]).toMatchObject({
      message: '@bob@activities.local Reply body'
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    await waitFor(async () => expect(await getDraft('draft-1')).toBeUndefined())
  })

  describe('emptying a draft in the editor', () => {
    const photo = {
      localId: 'photo-1',
      mediaId: 'media-1',
      owned: true,
      mediaType: 'image/png',
      fileName: 'photo.png',
      url: 'https://activities.local/media/photo.png',
      description: '',
      decorative: false,
      hasBlob: false
    }

    // Longer than the 800 ms autosave debounce.
    const pastDebounce = () =>
      new Promise((resolve) => setTimeout(resolve, 1700))

    // The save runs after the debounce plus a lazy import and an IndexedDB
    // write; polling for the stored state beats a fixed sleep under load.
    const expectStored = (expected: object) =>
      waitFor(
        async () => expect(await getDraft('draft-1')).toMatchObject(expected),
        { timeout: 5000 }
      )

    const clearText = async () => {
      const textarea = await screen.findByPlaceholderText(
        'What is on your mind?'
      )
      await waitFor(() => expect(textarea).toHaveValue('Stored text'))
      fireEvent.change(textarea, { target: { value: '' } })
    }

    it('keeps the draft and the editor open after the text is cleared', async () => {
      const { onClose } = await open(record({}))
      await clearText()
      await expectStored({ text: '' })
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByPlaceholderText('What is on your mind?')).toBeVisible()
    })

    it('deletes an empty draft without attachments when Close unmounts the editor', async () => {
      const { unmount } = await open(record({}))
      await clearText()
      await pastDebounce()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      unmount()

      await waitFor(async () =>
        expect(await getDraft('draft-1')).toBeUndefined()
      )
    })

    it('keeps an empty draft that still has an attachment on Close', async () => {
      const { unmount } = await open(record({ attachments: [photo] }))
      await clearText()
      await pastDebounce()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      unmount()

      await expectStored({
        text: '',
        attachments: [expect.objectContaining({ localId: 'photo-1' })]
      })
    })

    it('deletes an empty draft without attachments when the page is left', async () => {
      const { unmount } = await open(record({}))
      await clearText()
      unmount()

      await waitFor(async () =>
        expect(await getDraft('draft-1')).toBeUndefined()
      )
    })

    it('keeps an empty draft with an attachment when the page is left', async () => {
      const { unmount } = await open(record({ attachments: [photo] }))
      await clearText()
      unmount()

      await expectStored({ text: '' })
    })

    it('does not delete a reopened empty draft under React StrictMode', async () => {
      const { onClose, unmount } = await open(record({ text: '' }), {
        strict: true
      })
      await screen.findByPlaceholderText('What is on your mind?')
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(await getDraft('draft-1')).toBeDefined()
      expect(onClose).not.toHaveBeenCalled()
      // Leaving for real deletes it; settle that before the next test.
      unmount()
      await waitFor(async () =>
        expect(await getDraft('draft-1')).toBeUndefined()
      )
    })

    it('saves and discards nothing while the attachment bytes are still loading', async () => {
      const pending = {
        ...photo,
        localId: 'pending-1',
        mediaId: undefined,
        hasBlob: true
      }
      let release = () => {}
      const held = new Promise<void>((resolve) => (release = resolve))
      const real = vi.mocked(getDraftBlob).getMockImplementation()!
      vi.mocked(getDraftBlob).mockImplementationOnce(async (id) => {
        await held
        return real(id)
      })
      const { unmount } = await open(record({ attachments: [pending] }), {
        bytes: new File(['x'], 'photo.png', { type: 'image/png' })
      })
      // Seeding is held back, so the box is not yet restored.
      fireEvent.change(
        await screen.findByPlaceholderText('What is on your mind?'),
        { target: { value: '' } }
      )
      // Past the debounce: the autosave must not write the half-restored box.
      await pastDebounce()
      expect(await getDraft('draft-1')).toMatchObject({
        attachments: [expect.objectContaining({ localId: 'pending-1' })]
      })

      unmount()
      release()
      await pastDebounce()
      expect(await getDraft('draft-1')).toMatchObject({
        attachments: [expect.objectContaining({ localId: 'pending-1' })]
      })
    })
  })
})
