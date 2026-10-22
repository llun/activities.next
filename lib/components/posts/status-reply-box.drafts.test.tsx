/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

import { createNote, uploadAttachment } from '@/lib/client'
import { resetConnectionForTesting } from '@/lib/client/connection'
import {
  listDrafts,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { ApiRequestError } from '@/lib/client/http'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { createDeferred } from '@/lib/testing/deferred'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'
import { findSendAlert, sendAlerts } from '@/lib/testing/sendAlerts'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { resizeImage } from '@/lib/utils/resizeImage'

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage')

const createNoteMock = vi.mocked(createNote)
const uploadAttachmentMock = vi.mocked(uploadAttachment)

const profile: ActorProfile = {
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
  createdAt: 1
}

const replyStatus = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: 1,
  updatedAt: 1,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Original status',
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
} as unknown as StatusNote

const ACCOUNT_ID = 'account-1'

const renderBox = (
  props: Partial<React.ComponentProps<typeof StatusReplyBox>> = {}
) => {
  const onCancel = vi.fn()
  const view = render(
    <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        isMediaUploadEnabled
        onCancel={onCancel}
        onPostCreated={vi.fn()}
        {...props}
      />
    </DraftsProvider>
  )
  return { ...view, onCancel }
}

const textarea = () =>
  screen.getByPlaceholderText(/^Reply to/) as HTMLTextAreaElement
const type = (value: string) =>
  fireEvent.change(textarea(), { target: { value } })
const stored = () => listDrafts({ actorId: profile.id })
const waitForSaved = () =>
  screen.findByText('Saved on this device', {}, { timeout: 4000 })
const post = () => fireEvent.click(screen.getByRole('button', { name: 'Post' }))
const cancel = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

// Real IndexedDB plus a loaded machine: the 1 s default is too tight.
configure({ asyncUtilTimeout: 4000 })

describe('StatusReplyBox on-device drafts', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }))
    )
    vi.mocked(resizeImage).mockImplementation((file) => Promise.resolve(file))
    createNoteMock.mockResolvedValue({ status: replyStatus, attachments: [] })
    uploadAttachmentMock.mockImplementation(async (file) => ({
      id: `media-${file.name}`,
      type: 'upload',
      mediaType: 'image/png',
      url: `https://activities.local/media/${file.name}`,
      width: 100,
      height: 100
    }))
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    resetConnectionForTesting()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('saves nothing for the mention pre-fill alone', async () => {
    renderBox({
      replyStatus: {
        ...replyStatus,
        actorId: 'https://activities.local/users/bob',
        actor: {
          ...profile,
          id: 'https://activities.local/users/bob',
          username: 'bob',
          name: 'Bob'
        }
      } as unknown as StatusNote
    })
    await screen.findByDisplayValue(/@bob/)
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(await stored()).toHaveLength(0)
    expect(screen.queryByText(/Saving|Saved on this device/)).toBeNull()
  })

  it('saves typed text as a reply draft with the target', async () => {
    renderBox()

    type('A thoughtful reply')

    await waitForSaved()
    const [draft] = await stored()
    expect(draft).toMatchObject({
      composer: 'reply-box',
      text: 'A thoughtful reply',
      replyTo: { id: replyStatus.id }
    })
  })

  it('keeps text on Cancel as a draft', async () => {
    const { onCancel } = renderBox()
    type('Half a thought')
    await waitForSaved()

    cancel()

    expect(onCancel).toHaveBeenCalled()
    // Long enough for a discard to have finished deleting.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await stored()).toHaveLength(1)
  })

  it('leaves nothing behind when Cancel closes an empty reply', async () => {
    const { onCancel } = renderBox()

    cancel()

    expect(onCancel).toHaveBeenCalled()
    expect(await stored()).toHaveLength(0)
  })

  it('removes the draft when Cancel discards a locked reply', async () => {
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const { onCancel } = renderBox()
    type('Reply body')
    await waitForSaved()
    post()
    await waitFor(async () =>
      expect((await stored())[0]?.lockedMessage).toBeDefined()
    )

    cancel()

    expect(onCancel).toHaveBeenCalled()
    await waitFor(async () => expect(await stored()).toHaveLength(0))
  })

  it('says the reply was not saved, and offers its text, when Cancel cannot keep it', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { onCancel } = renderBox()
    type('A reply that cannot be stored')

    cancel()

    expect(onCancel).toHaveBeenCalled()
    const note = (await screen.findByText('Couldn’t save to Drafts')).closest(
      '[role="alert"]'
    ) as HTMLElement
    expect(note).not.toBeNull()
    expect(
      within(note).getByRole('button', { name: 'Copy text' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Saved to Drafts')).toBeNull()
  })

  it('shows "Not saved, copy your text" when the device storage is full', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    renderBox()

    type('A reply that cannot be stored')

    expect(
      await screen.findByText(
        'Not saved, copy your text',
        {},
        { timeout: 4000 }
      )
    ).toBeVisible()
  })

  describe('the checkpoint before sending', () => {
    it('does not send when the key cannot be written to the saved draft', async () => {
      renderBox()
      type('Reply body')
      await waitForSaved()
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      post()

      expect(await findSendAlert()).toHaveTextContent(
        "Your draft couldn't be saved on this device, so nothing was sent. Copy your text, then try again."
      )
      expect(createNoteMock).not.toHaveBeenCalled()
    })

    it('does not send after another tab changed the draft, and sends once after the reply is emptied and retyped', async () => {
      renderBox()
      type('Reply body')
      await waitForSaved()
      const [draft] = await stored()
      const other = await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      post()

      expect(await findSendAlert()).toHaveTextContent(
        'This draft was changed in another tab, so nothing was sent. Copy your text, then clear the box to start a new draft.'
      )
      expect(createNoteMock).not.toHaveBeenCalled()

      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )
      // The warning belonged to the draft the reply let go of.
      expect(screen.queryByText(/changed in another tab/)).toBeNull()
      type('A fresh reply')
      await waitForSaved()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
      )
      post()

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () => expect(await stored()).toEqual([other]))
    })

    it('does not send after another tab changed a draft that already holds a key', async () => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      renderBox()
      type('Reply body')
      await waitForSaved()
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () =>
        expect((await stored())[0].submit).toBeDefined()
      )
      const [draft] = await stored()
      await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      // An edit after the failed send needs a new key, so the checkpoint
      // must write (an unchanged one is already stored under the old key).
      type('Reply body, edited')
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
      )
      post()

      await waitFor(() =>
        expect(sendAlerts()[0]).toHaveTextContent('nothing was sent')
      )
      expect(createNoteMock).toHaveBeenCalledTimes(1)
      expect(await stored()).toHaveLength(1)
    })

    it('gives a new draft a new key after letting go of the other tab’s draft', async () => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      renderBox()
      type('Reply body')
      await waitForSaved()
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () =>
        expect((await stored())[0].submit).toBeDefined()
      )
      const [draft] = await stored()
      await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )
      type('Reply body, edited')
      await screen.findByText('Not saved, copy your text')

      // Emptied, then the same text again: the same content, but a new draft.
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )
      type('Reply body')
      await waitForSaved()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
      )
      post()

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      const [first, second] = createNoteMock.mock.calls.map(([call]) => call)
      expect(second.message).toBe(first.message)
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
    })
  })

  describe('reopened from Drafts', () => {
    const lockWithPhoto = async (error: unknown) => {
      createNoteMock.mockRejectedValueOnce(error)
      const first = renderBox()
      type('Reply body')
      fireEvent.change(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        {
          target: {
            files: [new File(['a'], 'a.png', { type: 'image/png' })]
          }
        }
      )
      await waitFor(() =>
        expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
      )
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      const key = createNoteMock.mock.calls[0][0].idempotencyKey
      await waitFor(async () => {
        const [draft] = await stored()
        expect(draft?.submit?.key).toBe(key)
        if (error instanceof ApiRequestError) {
          expect(draft?.lockedMessage).toBeDefined()
        }
      })
      first.unmount()
      const [draft] = await stored()
      return { key: key as string, draft }
    }

    it('comes back locked and retries under the same key without uploading again', async () => {
      const { key, draft } = await lockWithPhoto(
        new ApiRequestError('kept', 503)
      )
      expect(draft.attachments[0]).toMatchObject({
        mediaId: 'media-a.png',
        owned: false
      })
      const uploads = uploadAttachmentMock.mock.calls.length
      createNoteMock.mockClear()

      renderBox({ draft })

      await waitFor(() => expect(textarea()).toHaveAttribute('readonly'))
      expect(textarea()).toHaveValue('Reply body')
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toBe(key)
      expect(createNoteMock.mock.calls[0][0].attachments).toEqual([
        expect.objectContaining({ id: 'media-a.png' })
      ])
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(uploads)
    })

    it('reopens an uncertain send and retries under the same key without uploading again', async () => {
      const { key, draft } = await lockWithPhoto(new Error('lost response'))
      expect(draft.lockedMessage).toBeUndefined()
      const uploads = uploadAttachmentMock.mock.calls.length
      createNoteMock.mockClear()

      renderBox({ draft })

      await waitFor(() => expect(textarea()).toHaveValue('Reply body'))
      expect(textarea()).not.toHaveAttribute('readonly')
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toBe(key)
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(uploads)
    })

    it('keeps working on the reopened record: edits update it in place and a post deletes it', async () => {
      const { draft } = await lockWithPhoto(new Error('lost response'))
      createNoteMock.mockClear()

      renderBox({ draft })
      await waitFor(() => expect(textarea()).toHaveValue('Reply body'))
      type('Reply body, edited')
      await waitFor(async () => {
        const drafts = await stored()
        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toMatchObject({
          id: draft.id,
          text: 'Reply body, edited',
          revision: draft.revision + 1
        })
      })

      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () => expect(await stored()).toHaveLength(0), {
        timeout: 500
      })
    })

    it('uploads an attachment that never finished from the kept bytes when Post is pressed', async () => {
      const first = renderBox()
      type('Reply body')
      fireEvent.change(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        {
          target: {
            files: [new File(['b'], 'b.png', { type: 'image/png' })]
          }
        }
      )
      await waitFor(async () =>
        expect((await stored())[0]?.attachments[0]?.hasBlob).toBe(true)
      )
      first.unmount()
      const [draft] = await stored()
      expect(draft.attachments[0].mediaId).toBeUndefined()

      renderBox({ draft })
      await waitFor(() =>
        expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
      )
      post()

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
      expect(uploadAttachmentMock.mock.calls[0][0]).toMatchObject({
        name: 'b.png'
      })
    })
  })

  it('drops the draft once the reply is posted', async () => {
    renderBox()
    type('Reply body')
    await waitForSaved()

    post()

    // Released at once, not left for the next autosave (800 ms) to notice.
    await waitFor(async () => expect(await stored()).toHaveLength(0), {
      timeout: 500
    })
  })

  it('without drafts, a reply re-targeted while its photo uploads is sent with the photo', async () => {
    const upload =
      createDeferred<Awaited<ReturnType<typeof uploadAttachment>>>()
    const box = (id: string) => (
      <StatusReplyBox
        profile={profile}
        replyStatus={{ ...replyStatus, id }}
        isMediaUploadEnabled
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )
    const { rerender } = render(box(replyStatus.id))
    type('Reply body')
    uploadAttachmentMock.mockImplementationOnce(() => upload.promise)
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } }
    )
    await waitFor(() =>
      expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
    )
    post()
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalled())

    rerender(box(`${replyStatus.id}-other`))
    upload.resolve({
      id: 'media-b.png',
      type: 'upload',
      mediaType: 'image/png',
      url: 'https://activities.local/media/b.png',
      width: 100,
      height: 100
    })

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    expect(createNoteMock.mock.calls[0][0]).toMatchObject({
      inReplyToId: replyStatus.id,
      attachments: [expect.objectContaining({ id: 'media-b.png' })]
    })
  })

  it('a reply re-targeted before its first save keeps its own target', async () => {
    const { rerender } = renderBox()
    const prefill = textarea().value
    // Once one save lands the drafts store is ready; back to the pre-fill
    // (no draft), the next text is typed and re-targeted before it saves.
    type('Warming up')
    await waitForSaved()
    type(prefill)
    await waitFor(async () => expect(await stored()).toHaveLength(0))
    type('Typed for the first')
    rerender(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <StatusReplyBox
          profile={profile}
          replyStatus={{ ...replyStatus, id: `${replyStatus.id}-other` }}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </DraftsProvider>
    )

    await waitFor(async () =>
      expect(await stored()).toEqual([
        expect.objectContaining({
          text: expect.stringContaining('Typed for the first'),
          replyTo: expect.objectContaining({ id: replyStatus.id })
        })
      ])
    )
  })

  it('finishes a reply for its own target before moving to the new one', async () => {
    const send = createDeferred<Awaited<ReturnType<typeof createNote>>>()
    createNoteMock.mockImplementationOnce(() => send.promise)
    const onPostCreated = vi.fn()
    const { rerender } = renderBox({ onPostCreated })
    type('Reply body')
    await waitForSaved()
    post()
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    rerender(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <StatusReplyBox
          profile={profile}
          replyStatus={{ ...replyStatus, id: `${replyStatus.id}-other` }}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={onPostCreated}
        />
      </DraftsProvider>
    )
    expect(textarea()).toHaveValue('Reply body')
    send.reject(new ApiRequestError('kept', 503))

    await waitFor(() => expect(textarea()).not.toHaveValue('Reply body'))
    await waitFor(async () =>
      expect((await stored())[0]?.lockedMessage).toBeTruthy()
    )
    const [draft] = await stored()
    expect(draft.replyTo?.id).toBe(replyStatus.id)
    expect(draft.submit?.key).toBe(
      createNoteMock.mock.calls[0][0].idempotencyKey
    )
  })

  it('does not carry the sent reply’s photo over to the new target', async () => {
    const send = createDeferred<Awaited<ReturnType<typeof createNote>>>()
    createNoteMock.mockImplementationOnce(() => send.promise)
    const onPostCreated = vi.fn()
    const { rerender } = renderBox({ onPostCreated })
    type('Reply body')
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      { target: { files: [new File(['b'], 'b.png', { type: 'image/png' })] } }
    )
    await waitFor(() =>
      expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
    )
    post()
    await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalled())
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    rerender(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <StatusReplyBox
          profile={profile}
          replyStatus={{ ...replyStatus, id: `${replyStatus.id}-other` }}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={onPostCreated}
        />
      </DraftsProvider>
    )
    send.resolve({ status: replyStatus, attachments: [] })
    await waitFor(() => expect(onPostCreated).toHaveBeenCalled())

    expect(document.querySelectorAll('div.aspect-square')).toHaveLength(0)
  })

  it('drops the sent draft when re-targeted while the reply is in flight', async () => {
    const send = createDeferred<Awaited<ReturnType<typeof createNote>>>()
    createNoteMock.mockImplementationOnce(() => send.promise)
    const onPostCreated = vi.fn()
    const { rerender } = renderBox({ onPostCreated })
    type('Reply body')
    await waitForSaved()
    post()
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    rerender(
      <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
        <StatusReplyBox
          profile={profile}
          replyStatus={{ ...replyStatus, id: `${replyStatus.id}-other` }}
          isMediaUploadEnabled
          onCancel={vi.fn()}
          onPostCreated={onPostCreated}
        />
      </DraftsProvider>
    )
    send.resolve({ status: replyStatus, attachments: [] })
    await waitFor(() => expect(onPostCreated).toHaveBeenCalled())

    await waitFor(async () => expect(await stored()).toHaveLength(0))
  })
})
