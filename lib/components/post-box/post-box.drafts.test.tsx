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
import { StrictMode } from 'react'

import {
  createPoll,
  deleteAccountMedia,
  deleteFitnessFile,
  deleteUnpostedFitnessFile,
  deleteUnpostedMedia,
  updateNote,
  uploadFitnessFile
} from '@/lib/client'
import { resetConnectionForTesting } from '@/lib/client/connection'
import {
  type DraftRecord,
  deleteDraftIfRevision,
  getDraftBlob,
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
import { Status, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'
import {
  attach,
  createNoteMock,
  profile,
  resetPostBoxMediaMocks,
  uploadAttachmentMock,
  uploaded
} from './post-box-media.testUtils'
import { choosePostOption } from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  // The unguarded deletes: the composer must never call them.
  deleteAccountMedia: vi.fn(),
  deleteFitnessFile: vi.fn(),
  deleteUnpostedMedia: vi.fn().mockResolvedValue(undefined),
  createPoll: vi.fn(),
  deleteUnpostedFitnessFile: vi.fn().mockResolvedValue(true),
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

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

const ACCOUNT_ID = 'account-1'

const quoted = {
  id: 'https://activities.local/users/bob/statuses/quoted',
  actorId: 'https://activities.local/users/bob',
  actor: {
    id: 'https://activities.local/users/bob',
    username: 'bob',
    domain: 'activities.local',
    name: 'Bob'
  },
  type: StatusType.enum.Note,
  text: 'a quoted post',
  tags: [],
  to: [],
  cc: []
} as unknown as Status

type Props = Partial<React.ComponentProps<typeof PostBox>>

const composer = (props: Props = {}) => (
  <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
    <PostBox
      host="activities.local"
      profile={profile}
      isMediaUploadEnabled
      onDiscardReply={vi.fn()}
      onPostCreated={vi.fn()}
      onPostUpdated={vi.fn()}
      onDiscardEdit={vi.fn()}
      {...props}
    />
  </DraftsProvider>
)

const textarea = () =>
  screen.getByPlaceholderText('What is on your mind?') as HTMLTextAreaElement

const storedDrafts = () => listDrafts({ actorId: profile.id })

const waitForSaved = () =>
  screen.findByText('Saved on this device', {}, { timeout: 4000 })

const type = (value: string) =>
  fireEvent.change(textarea(), { target: { value } })

const failOnce = (error: unknown) => createNoteMock.mockRejectedValueOnce(error)

const makeFull = () =>
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })

// Real IndexedDB plus a loaded machine: the 1 s default is too tight.
configure({ asyncUtilTimeout: 4000 })

describe('PostBox on-device drafts', () => {
  beforeEach(() => {
    resetPostBoxMediaMocks()
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }))
    )
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetConnectionForTesting()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('saves what is typed and says so', async () => {
    render(composer())

    type('Draft in progress')

    expect(await screen.findByText('Saving…')).toBeInTheDocument()
    await waitForSaved()
    const [draft] = await storedDrafts()
    expect(draft).toMatchObject({
      text: 'Draft in progress',
      composer: 'post-box',
      accountId: ACCOUNT_ID,
      actorId: profile.id
    })
  })

  it('does not autosave an edit of a published post', async () => {
    render(
      composer({
        editStatus: {
          id: 'https://activities.local/users/llun/statuses/post-1',
          actorId: profile.id,
          actor: profile,
          type: StatusType.enum.Note,
          text: 'Original',
          summary: null,
          attachments: [],
          tags: [],
          to: [],
          cc: [],
          edits: []
        } as never
      })
    )

    type('Original, edited')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(screen.queryByText(/Saving|Saved on this device/)).toBeNull()
    expect(await storedDrafts()).toHaveLength(0)
  })

  it('never offers a failed edit as a draft when the next post to edit opens', async () => {
    const edited = (id: string) =>
      ({
        id: `https://activities.local/users/llun/statuses/${id}`,
        actorId: profile.id,
        actor: profile,
        type: StatusType.enum.Note,
        text: `Original ${id}`,
        summary: null,
        attachments: [],
        tags: [],
        to: [],
        cc: [],
        edits: []
      }) as never
    const update = createDeferred<never>()
    vi.mocked(updateNote).mockImplementationOnce(() => update.promise)
    const { rerender } = render(composer({ editStatus: edited('post-1') }))
    type('Original post-1, edited')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1))

    rerender(composer({ editStatus: edited('post-2') }))
    update.reject(new Error('offline'))

    await waitFor(() => expect(textarea()).toHaveValue('Original post-2'))
    expect(screen.queryByText('Couldn’t save to Drafts')).toBeNull()
    expect(screen.queryByText('Saved to Drafts')).toBeNull()
  })

  it('never saves an edit as a draft when it turns into a quote mid-update', async () => {
    const post = {
      id: 'https://activities.local/users/llun/statuses/post-1',
      actorId: profile.id,
      actor: profile,
      type: StatusType.enum.Note,
      text: 'Followers only',
      summary: null,
      attachments: [],
      tags: [],
      to: [],
      cc: [],
      edits: []
    } as never
    const update = createDeferred<never>()
    vi.mocked(updateNote).mockImplementationOnce(() => update.promise)
    const { rerender } = render(composer({ editStatus: post }))
    type('Followers only, edited')
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1))

    rerender(composer({ quotedStatus: post }))
    // Longer than the autosave pause, while the update is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    update.reject(new Error('offline'))
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(await storedDrafts()).toHaveLength(0)
  })

  it('keeps a failed quote in Drafts when the row turns into an edit mid-send', async () => {
    const post = {
      id: 'https://activities.local/users/llun/statuses/post-1',
      actorId: profile.id,
      actor: profile,
      type: StatusType.enum.Note,
      text: 'The quoted post',
      summary: null,
      attachments: [],
      tags: [],
      to: [],
      cc: [],
      edits: []
    } as never
    const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
    createNoteMock.mockImplementationOnce(() => send.promise)
    const { rerender } = render(composer({ quotedStatus: post }))
    type('My take on it')
    await waitForSaved()
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    rerender(composer({ editStatus: post }))
    send.reject(new Error('offline'))

    expect(await screen.findByText('Saved to Drafts')).toBeVisible()
    expect((await storedDrafts())[0]).toMatchObject({
      text: 'My take on it',
      quoteOf: expect.objectContaining({
        id: 'https://activities.local/users/llun/statuses/post-1'
      })
    })
  })

  it('shows "Not saved, copy your text" when the device storage is full', async () => {
    makeFull()
    render(composer())

    type('This cannot be stored')

    expect(
      await screen.findByText(
        'Not saved, copy your text',
        {},
        { timeout: 4000 }
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeVisible()
  })

  it('makes no draft for the pre-fill of a reply', async () => {
    render(
      composer({
        replyStatus: {
          ...quoted,
          actorId: 'https://activities.local/users/bob'
        } as Status
      })
    )
    await screen.findByDisplayValue(/@bob/)
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(await storedDrafts()).toHaveLength(0)
  })

  describe('re-targeted while a send is in flight', () => {
    const replyTo = (id: string) =>
      ({
        ...quoted,
        id: `https://activities.local/users/bob/statuses/${id}`
      }) as Status

    const pendingSend = () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      return () => send.resolve({ status: {} as never, attachments: [] })
    }

    it('finishes the send for its own target, then moves to the new one', async () => {
      const finish = pendingSend()
      const onPostCreated = vi.fn()
      const { rerender } = render(
        composer({ replyStatus: replyTo('first'), onPostCreated })
      )
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      rerender(composer({ replyStatus: replyTo('second'), onPostCreated }))
      // Still the send's own composer until it settles.
      expect(textarea().value).toBe('@bob@activities.local my reply')
      finish()
      await waitFor(() => expect(onPostCreated).toHaveBeenCalled())

      expect(createNoteMock.mock.calls[0][0].replyStatus?.id).toBe(
        replyTo('first').id
      )
      await waitFor(() => expect(textarea().value).not.toContain('my reply'))
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(0))
      // Sent: nothing is kept or offered on the way to the new target.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      expect(screen.queryByText('Couldn’t save to Drafts')).toBeNull()
    })

    it('moves on quietly once a poll in flight is created', async () => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      const send = createDeferred<undefined>()
      vi.mocked(createPoll).mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local which one?')
      await choosePostOption('Poll')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1))

      rerender(composer({ replyStatus: replyTo('second') }))
      send.resolve(undefined)

      await waitFor(() => expect(textarea().value).not.toContain('which one?'))
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      expect(screen.queryByText('Couldn’t save to Drafts')).toBeNull()
    })

    it('without drafts, a re-target abandons the photo it uploaded', async () => {
      const box = (id: string) => (
        <PostBox
          host="activities.local"
          profile={profile}
          replyStatus={replyTo(id)}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )
      const { rerender } = render(box('first'))
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })

      rerender(box('second'))

      await waitFor(() =>
        expect(deleteUnpostedMedia).toHaveBeenCalledWith('media-a.png')
      )
    })

    it('sends the photo of a post re-targeted while it uploads', async () => {
      const upload =
        createDeferred<Awaited<ReturnType<typeof uploadAttachmentMock>>>()
      uploadAttachmentMock.mockImplementationOnce(() => upload.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalled())

      rerender(composer({ replyStatus: replyTo('second') }))
      upload.resolve(uploaded('media-a.png', 'a.png'))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0]).toMatchObject({
        replyStatus: expect.objectContaining({ id: replyTo('first').id }),
        attachments: [expect.objectContaining({ id: 'media-a.png' })]
      })
    })

    it('locks a kept post for its own target, then moves to the new one', async () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      const key = createNoteMock.mock.calls[0][0].idempotencyKey

      rerender(composer({ replyStatus: replyTo('second') }))
      send.reject(new ApiRequestError('kept', 503))

      await waitFor(() => expect(textarea().value).not.toContain('my reply'))
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.lockedMessage).toBeTruthy()
      )
      const [draft] = await storedDrafts()
      expect(draft.submit?.key).toBe(key)
      expect(draft.replyTo?.id).toBe(replyTo('first').id)
      expect(draft.text).toBe('@bob@activities.local my reply')
    })

    it('a draft re-targeted before its first save keeps its own target', async () => {
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      const prefill = textarea().value
      // Once one save lands the drafts store is ready; back to the pre-fill
      // (no draft), the next text is typed and re-targeted before it saves.
      type('@bob@activities.local warming up')
      await waitForSaved()
      type(prefill)
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(0))
      type('@bob@activities.local typed for the first')
      rerender(composer({ replyStatus: replyTo('second') }))

      await waitFor(async () =>
        expect(await storedDrafts()).toEqual([
          expect.objectContaining({
            text: '@bob@activities.local typed for the first',
            replyTo: expect.objectContaining({ id: replyTo('first').id })
          })
        ])
      )
    })

    it('a saved draft left behind on a re-target keeps its target and last edit', async () => {
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local saved')
      await waitForSaved()
      type('@bob@activities.local saved, then edited')
      rerender(composer({ replyStatus: replyTo('second') }))

      await waitFor(async () =>
        expect(await storedDrafts()).toEqual([
          expect.objectContaining({
            text: '@bob@activities.local saved, then edited',
            replyTo: expect.objectContaining({ id: replyTo('first').id })
          })
        ])
      )
    })

    it('keeps a failed post in Drafts and says so before moving to the new target', async () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      rerender(composer({ replyStatus: replyTo('second') }))
      send.reject(new Error('offline'))

      expect(await screen.findByText('Saved to Drafts')).toBeVisible()
      await waitFor(() => expect(textarea().value).not.toContain('my reply'))
      const [draft] = await storedDrafts()
      expect(draft).toMatchObject({
        text: '@bob@activities.local my reply',
        replyTo: expect.objectContaining({ id: replyTo('first').id })
      })
    })

    it('offers the text of a failed post it could not keep before moving on', async () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      makeFull()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      rerender(composer({ replyStatus: replyTo('second') }))
      send.reject(new Error('offline'))

      expect(await screen.findByText('Couldn’t save to Drafts')).toBeVisible()
    })

    it('stays put after a failed send when only the profile changed', async () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      rerender(
        composer({ replyStatus: replyTo('first'), profile: { ...profile } })
      )
      send.reject(new Error('offline'))

      expect(await findSendAlert()).toHaveTextContent("Couldn't send.")
      // Nothing moves on later either: no keep, no re-target.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      expect(textarea().value).toBe('@bob@activities.local my reply')
    })

    it('stays put after a failed send when the target went away and came back', async () => {
      const send = createDeferred<Awaited<ReturnType<typeof createNoteMock>>>()
      createNoteMock.mockImplementationOnce(() => send.promise)
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      rerender(composer({ replyStatus: replyTo('second') }))
      rerender(composer({ replyStatus: replyTo('first') }))
      send.reject(new Error('offline'))

      expect(await findSendAlert()).toHaveTextContent("Couldn't send.")
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      expect(textarea().value).toBe('@bob@activities.local my reply')
    })

    it('cannot dismiss the reply while it is being sent', async () => {
      pendingSend()
      render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      type('@bob@activities.local my reply')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      expect(
        screen.getByRole('button', { name: 'Dismiss reply' })
      ).toBeDisabled()
    })
  })

  describe('media a saved draft owns', () => {
    it('does not delete the media when the composer goes away', async () => {
      const { unmount } = render(composer())
      type('with a photo')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )

      unmount()

      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      const [draft] = await storedDrafts()
      expect(draft.attachments[0]).toMatchObject({
        mediaId: 'media-a.png',
        owned: true,
        hasBlob: true
      })
      // The bytes are kept after the upload (owner decision).
      expect(await getDraftBlob(draft.attachments[0].localId)).toBeDefined()
    })

    it('does not delete the media of a draft that is saved while the composer unmounts', async () => {
      const { unmount } = render(composer())
      // The provider resolves its epoch first: bytes are not written before.
      await new Promise((resolve) => setTimeout(resolve, 100))
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })

      // Unmounted before the debounce fired: the flush still keeps it.
      unmount()

      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(1))
    })

    it('still deletes the media of an empty composer with no draft', async () => {
      const { unmount } = render(
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })

      unmount()

      expect(deleteUnpostedMedia).toHaveBeenCalledWith('media-a.png')
    })

    it('deletes the media when no draft could be stored', async () => {
      setDraftsIndexedDBFactory(null)
      vi.stubGlobal('indexedDB', undefined)
      const { unmount } = render(composer())
      type('with a photo')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await screen.findByText('Not saved, copy your text')
      // The debounced save has run and failed too: nothing is pending.
      await new Promise((resolve) => setTimeout(resolve, 1100))

      unmount()

      expect(deleteUnpostedMedia).toHaveBeenCalledWith('media-a.png')
    })

    it('shows "Not saved" when the photo bytes cannot be stored', async () => {
      render(composer())
      makeFull()

      attach('a.png')

      expect(
        await screen.findByText(
          'Not saved, copy your text',
          {},
          { timeout: 4000 }
        )
      ).toBeVisible()
    })
  })

  describe('another tab may hold the same draft', () => {
    const chooseFitnessFile = (container: HTMLElement) =>
      fireEvent.change(
        container.querySelector(
          'input[type="file"][accept=".fit,.gpx,.tcx"]'
        ) as HTMLInputElement,
        { target: { files: [new File(['data'], 'run.gpx')] } }
      )

    // Tab B posts the draft and releases it: its post now uses the uploads.
    const sendFromAnotherTab = async () => {
      const [stored] = await storedDrafts()
      await deleteDraftIfRevision(stored.id, stored.revision)
    }

    // A send whose response was lost: the uploads exist, the draft holds them.
    const failToSend = async (setup: (container: HTMLElement) => void) => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      const view = render(composer())
      setup(view.container)
      fireEvent.click(await screen.findByRole('button', { name: 'Post' }))
      await findSendAlert()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attemptedAt).toBeDefined()
      )
      return view
    }

    const withPhoto = async () => {
      type('with a photo')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
    }

    const withFitnessFile = (container: HTMLElement) => {
      vi.mocked(uploadFitnessFile).mockResolvedValueOnce({
        id: 'fitness-1'
      } as never)
      chooseFitnessFile(container)
      type('Morning run')
    }

    const removePhoto = () =>
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media a.png' })
      )

    const removeFitnessFile = async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove selected fitness file' })
      )
      await waitFor(() => expect(screen.queryByText('run.gpx')).toBeNull())
    }

    // The composer finds out on its next save.
    const conflict = async () => {
      type('edited here too')
      await screen.findByText('Not saved, copy your text')
    }

    it('removing a photo another tab sent deletes nothing after the conflict', async () => {
      render(composer())
      await withPhoto()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      // The record is readable a moment before the composer hears its
      // save landed.
      await waitForSaved()
      await sendFromAnotherTab()

      removePhoto()
      // The save that would have let it go finds the draft gone.
      await screen.findByText('Not saved, copy your text')
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )
      type('a fresh start')
      await waitForSaved()

      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })

    it('removing a fitness file another tab sent deletes nothing', async () => {
      await failToSend(withFitnessFile)
      await sendFromAnotherTab()

      await removeFitnessFile()
      await screen.findByText('Not saved, copy your text')

      expect(deleteFitnessFile).not.toHaveBeenCalled()
      expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
    })

    // Tab B saved a newer revision that still holds the upload; this tab has
    // not saved since, so it does not know yet.
    const saveInAnotherTab = async () => {
      const [stored] = await storedDrafts()
      await saveDraft(
        { ...stored, text: 'edited in another tab' },
        { expectedRevision: stored.revision, epoch: 0 }
      )
    }

    it('a stale tab removing a photo leaves it for the newer revision', async () => {
      render(composer())
      await withPhoto()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      // The record is readable a moment before the composer hears its
      // save landed.
      await waitForSaved()
      await saveInAnotherTab()

      removePhoto()
      await screen.findByText('Not saved, copy your text')

      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      const [stored] = await storedDrafts()
      expect(stored.text).toBe('edited in another tab')
      expect(stored.attachments[0]?.mediaId).toBe('media-a.png')
    })

    it('a stale tab emptying its composer leaves the photo for the newer revision', async () => {
      render(composer())
      attach('a.png')
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      // The record is readable a moment before the composer hears its
      // save landed.
      await waitForSaved()
      await saveInAnotherTab()

      removePhoto()
      // The debounced emptying delete has run and found the newer revision.
      await new Promise((resolve) => setTimeout(resolve, 1100))

      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      const [stored] = await storedDrafts()
      expect(stored.attachments[0]?.mediaId).toBe('media-a.png')
    })

    it('a fresh upload removed before any save is deleted at once', async () => {
      render(composer())
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })

      removePhoto()

      expect(deleteUnpostedMedia).toHaveBeenCalledExactlyOnceWith('media-a.png')
    })

    it('a conflicted composer deletes no photo on the server', async () => {
      render(composer())
      await withPhoto()
      await waitForSaved()
      await sendFromAnotherTab()
      await conflict()

      removePhoto()
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )

      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })

    it('a conflicted composer deletes no fitness file on the server', async () => {
      await failToSend(withFitnessFile)
      await sendFromAnotherTab()
      await conflict()

      await removeFitnessFile()

      expect(deleteFitnessFile).not.toHaveBeenCalled()
      expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
    })

    it('a conflicted composer deletes a photo uploaded since its last save', async () => {
      render(composer())
      await withPhoto()
      await waitForSaved()
      await sendFromAnotherTab()
      await conflict()

      attach('b.png')
      fireEvent.click(
        await screen.findByRole('button', { name: 'Remove media b.png' })
      )

      // No record holds it: only this tab ever had it.
      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(deleteUnpostedMedia).toHaveBeenCalledExactlyOnceWith('media-b.png')
    })

    // Only after this tab's own save lands does it hold the newest revision; a
    // copy in another tab then conflicts before it can post, and the server
    // keeps (422) anything a post uses.
    it('a reopened draft deletes a photo it came with through the guarded delete', async () => {
      const first = render(composer())
      await withPhoto()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      first.unmount()
      const [draft] = await storedDrafts()

      render(composer({ draft }))
      await screen.findByRole('button', { name: 'Remove media a.png' })
      removePhoto()

      // Not before this tab's save lands: another tab may hold a newer one.
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments).toEqual([])
      )
      await waitFor(() =>
        expect(deleteUnpostedMedia).toHaveBeenCalledWith('media-a.png')
      )
      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(deleteUnpostedMedia).toHaveBeenCalledTimes(1)
    })

    it('an emptied reopened draft deletes its photo once the record is gone', async () => {
      const first = render(composer())
      attach('a.png')
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      first.unmount()
      const [draft] = await storedDrafts()

      render(composer({ draft }))
      await screen.findByRole('button', { name: 'Remove media a.png' })
      removePhoto()

      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      await waitFor(async () => expect(await storedDrafts()).toEqual([]))
      await waitFor(() =>
        expect(deleteUnpostedMedia).toHaveBeenCalledWith('media-a.png')
      )
      expect(deleteUnpostedMedia).toHaveBeenCalledTimes(1)
    })

    it('an emptied reopened draft deletes nothing when another tab already removed the record', async () => {
      const first = render(composer())
      attach('a.png')
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.attachments[0]?.mediaId).toBe(
          'media-a.png'
        )
      )
      first.unmount()
      const [draft] = await storedDrafts()

      render(composer({ draft }))
      await screen.findByRole('button', { name: 'Remove media a.png' })
      // Another tab sent, discarded or signed out of the draft: that tab may
      // still be attaching the photo.
      await sendFromAnotherTab()
      removePhoto()

      // The debounced emptying delete has run and found no record.
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })

    it('a reopened draft deletes a fitness file it came with through the guarded delete', async () => {
      // Uploaded, then the send stopped before its attempt (a photo upload
      // failed, say): the draft owns the file and no post can use it.
      const first = render(composer())
      type('Morning run')
      await waitForSaved()
      first.unmount()
      const [saved] = await storedDrafts()
      const draft = await saveDraft(
        {
          ...saved,
          fitnessFile: {
            localId: 'fitness-local',
            fileName: 'run.gpx',
            mimeType: 'application/gpx+xml',
            size: 4,
            fitnessFileId: 'fitness-1',
            owned: true,
            hasBlob: false
          }
        },
        { expectedRevision: saved.revision, epoch: 0 }
      )

      render(composer({ draft }))
      await screen.findByText('run.gpx')
      await removeFitnessFile()

      expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.fitnessFile).toBeUndefined()
      )
      await waitFor(() =>
        expect(deleteUnpostedFitnessFile).toHaveBeenCalledWith('fitness-1')
      )
      expect(deleteFitnessFile).not.toHaveBeenCalled()
      expect(deleteUnpostedFitnessFile).toHaveBeenCalledTimes(1)
    })

    it('a stale tab removing a fitness file leaves it for the newer revision', async () => {
      await failToSend(withFitnessFile)
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.fitnessFile?.fitnessFileId).toBe(
          'fitness-1'
        )
      )
      // The record is readable a moment before the composer hears its
      // save landed.
      await waitForSaved()
      await saveInAnotherTab()

      await removeFitnessFile()
      await screen.findByText('Not saved, copy your text')

      expect(deleteFitnessFile).not.toHaveBeenCalled()
      expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
      const [stored] = await storedDrafts()
      expect(stored.fitnessFile?.fitnessFileId).toBe('fitness-1')
    })
  })

  describe('the Alert', () => {
    it('shows a failed send after the composer card, never through window.alert', async () => {
      failOnce(new Error('The server said no'))
      const { container } = render(composer({ frameClassName: 'card' }))
      type('hello')
      await waitForSaved()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      const alert = await findSendAlert()
      expect(alert).toHaveTextContent("Couldn't send.")
      expect(alert).toHaveTextContent('The server said no')
      expect(alert).toHaveTextContent(
        'The server said no. Your post is saved as a draft.'
      )
      const card = container.querySelector('section.card') as HTMLElement
      expect(card.contains(alert)).toBe(false)
      expect(
        card.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(window.alert).not.toHaveBeenCalled()
      // The feed under the home card is pulled up on a phone; the Alert keeps
      // its own gap from it, as padding (a margin would collapse into the pull).
      expect(alert.parentElement).toHaveClass('max-md:pb-6')
    })

    it('does not reserve that phone gap for a composer without a card', async () => {
      failOnce(new Error('The server said no'))
      render(composer())
      type('hello')
      await waitForSaved()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      const alert = await findSendAlert()
      expect(alert.parentElement).not.toHaveClass('max-md:pb-6')
    })

    it('retries from the Alert under the same key', async () => {
      failOnce(new Error('offline'))
      render(composer())
      type('hello')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await findSendAlert()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      expect(createNoteMock.mock.calls[1][0].idempotencyKey).toBe(
        createNoteMock.mock.calls[0][0].idempotencyKey
      )
      await waitFor(() => expect(sendAlerts()).toHaveLength(0))
    })

    it('says nothing but the lock line when the server kept the post', async () => {
      failOnce(new ApiRequestError('kept', 503))
      render(composer())
      type('hello')

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      expect(await screen.findByText(/Editing is locked/)).toBeInTheDocument()
      expect(sendAlerts()).toHaveLength(0)
      expect(window.alert).not.toHaveBeenCalled()
    })
  })

  describe('the checkpoint before sending (a lost key must never mean a duplicate)', () => {
    const saveThenFailToCheckpoint = async () => {
      const view = render(composer())
      type('hello')
      await waitForSaved()
      return view
    }

    it('does not send when the key cannot be written to the saved draft', async () => {
      await saveThenFailToCheckpoint()
      makeFull()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      const alert = await findSendAlert()
      expect(alert).toHaveTextContent(
        "Your draft couldn't be saved on this device, so nothing was sent. Copy your text, then try again."
      )
      expect(createNoteMock).not.toHaveBeenCalled()
      expect(screen.getByText('Not saved, copy your text')).toBeVisible()
      expect(textarea()).not.toHaveAttribute('readonly')
    })

    it('does not create a poll when the key cannot be written to the saved draft', async () => {
      // The poll editor's Radix Switch measures itself; jsdom has none.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      vi.mocked(createPoll).mockClear()
      await saveThenFailToCheckpoint()
      await choosePostOption('Poll')
      makeFull()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      expect(await findSendAlert()).toHaveTextContent('nothing was sent')
      expect(createPoll).not.toHaveBeenCalled()
      expect(createNoteMock).not.toHaveBeenCalled()
    })

    it('sends once the checkpoint can be written again', async () => {
      await saveThenFailToCheckpoint()
      const full = makeFull()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await findSendAlert()
      full.mockRestore()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toEqual(
        expect.any(String)
      )
    })

    it('does not send after another tab changed the draft, and sends once after the composer is emptied and retyped', async () => {
      await saveThenFailToCheckpoint()
      const [draft] = await storedDrafts()
      const other = await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      // Trying again cannot work: only a new draft can be sent.
      const alert = await findSendAlert()
      expect(alert).toHaveTextContent(
        'This draft was changed in another tab, so nothing was sent. Copy your text, then clear the box to start a new draft.'
      )
      expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
      expect(createNoteMock).not.toHaveBeenCalled()
      expect(screen.getByText('Not saved, copy your text')).toBeVisible()

      // Emptied, the composer lets go of the other tab's draft.
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )
      // The Alert belonged to the draft the composer let go of.
      expect(sendAlerts()).toHaveLength(0)
      type('a fresh start')
      await waitForSaved()
      expect(await storedDrafts()).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].message).toBe('a fresh start')
      // The sent draft is released; the other tab's is exactly as it was.
      await waitFor(async () => expect(await storedDrafts()).toEqual([other]))
    })

    it('does not send after another tab changed a draft that already holds a key', async () => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      await saveThenFailToCheckpoint()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () =>
        expect((await storedDrafts())[0].submit).toBeDefined()
      )
      const [draft] = await storedDrafts()
      await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      // An edit after the failed send needs a new key, so the checkpoint
      // must write (an unchanged one is already stored under the old key).
      type('hello again')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() =>
        expect(sendAlerts()[0]).toHaveTextContent('nothing was sent')
      )
      expect(createNoteMock).toHaveBeenCalledTimes(1)
      const all = await storedDrafts()
      expect(all).toHaveLength(1)
      expect(all[0].submit?.key).toBe(
        createNoteMock.mock.calls[0][0].idempotencyKey
      )
    })

    it('gives a new draft a new key after letting go of the other tab’s draft', async () => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      render(composer())
      type('hello')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await findSendAlert()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.submit).toBeDefined()
      )
      const [draft] = await storedDrafts()
      await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )
      type('hello there')
      await screen.findByText('Not saved, copy your text')

      // Emptied, then the same text again: the same content, but a new draft.
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Not saved, copy your text')).toBeNull()
      )
      type('hello')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      const [first, second] = createNoteMock.mock.calls.map(([call]) => call)
      expect(second.message).toBe(first.message)
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
    })

    it('gives a new key when the composer is emptied before it notices the other tab', async () => {
      createNoteMock.mockRejectedValueOnce(new Error('lost response'))
      render(composer())
      type('hello')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await findSendAlert()
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.submit).toBeDefined()
      )
      const [draft] = await storedDrafts()
      const other = await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      // The emptying save is the one that finds the newer revision.
      type('')
      await waitFor(() =>
        expect(screen.queryByText('Saved on this device')).toBeNull()
      )
      await new Promise((resolve) => setTimeout(resolve, 1100))
      type('hello')
      await waitForSaved()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      const [first, second] = createNoteMock.mock.calls.map(([call]) => call)
      expect(second.message).toBe(first.message)
      expect(second.idempotencyKey).not.toBe(first.idempotencyKey)
      expect(await storedDrafts()).toContainEqual(other)
    })

    it('writes the key and the attempt before the request leaves', async () => {
      let stored: DraftRecord | undefined
      createNoteMock.mockImplementationOnce(async () => {
        ;[stored] = await storedDrafts()
        throw new Error('lost response')
      })
      render(composer())
      type('hello')
      await waitForSaved()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await findSendAlert()

      expect(stored?.submit?.key).toBe(
        createNoteMock.mock.calls[0][0].idempotencyKey
      )
      expect(stored?.attemptedAt).toEqual(expect.any(Number))
    })
  })

  describe('a locked or uncertain draft reopened from Drafts keeps its key', () => {
    const post = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    // A reopened draft enables Post a render after it shows its text; under
    // load a click in between hits a disabled button and is lost.
    const postWhenReady = async () => {
      const button = await screen.findByRole('button', { name: 'Post' })
      await waitFor(() => expect(button).toBeEnabled())
      fireEvent.click(button)
    }

    const sendWithPhoto = async (error: unknown) => {
      failOnce(error)
      const first = render(composer())
      type('First post')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      post()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      const key = createNoteMock.mock.calls[0][0].idempotencyKey
      await waitFor(async () => {
        const [draft] = await storedDrafts()
        expect(draft?.submit?.key).toBe(key)
        expect(draft?.attemptedAt).toBeDefined()
      })
      // The lock is written after the failure lands.
      if (error instanceof ApiRequestError) {
        await waitFor(async () =>
          expect((await storedDrafts())[0].lockedMessage).toBeDefined()
        )
      } else {
        await findSendAlert()
      }
      first.unmount()
      const [draft] = await storedDrafts()
      return { key: key as string, draft }
    }

    it('reopens locked and retries under the same key without uploading again', async () => {
      const { key, draft } = await sendWithPhoto(
        new ApiRequestError('kept', 503)
      )
      expect(draft.attachments[0]).toMatchObject({
        mediaId: 'media-a.png',
        owned: false
      })
      const uploads = uploadAttachmentMock.mock.calls.length
      createNoteMock.mockClear()

      render(composer({ draft }))

      await waitFor(() => expect(textarea()).toHaveAttribute('readonly'))
      expect(textarea()).toHaveValue('First post')
      expect(screen.getByText(/Editing is locked/)).toBeInTheDocument()
      await postWhenReady()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toBe(key)
      expect(createNoteMock.mock.calls[0][0].attachments).toEqual([
        expect.objectContaining({ id: 'media-a.png' })
      ])
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(uploads)
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })

    it('reopens an uncertain send (no lock) and retries under the same key without uploading again', async () => {
      const { key, draft } = await sendWithPhoto(new Error('lost response'))
      expect(draft.lockedMessage).toBeUndefined()
      const uploads = uploadAttachmentMock.mock.calls.length
      createNoteMock.mockClear()

      render(composer({ draft }))

      await waitFor(() => expect(textarea()).toHaveValue('First post'))
      expect(textarea()).not.toHaveAttribute('readonly')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await postWhenReady()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toBe(key)
      expect(uploadAttachmentMock).toHaveBeenCalledTimes(uploads)
    })

    it('survives React StrictMode', async () => {
      const { key, draft } = await sendWithPhoto(
        new ApiRequestError('kept', 409)
      )
      createNoteMock.mockClear()

      render(<StrictMode>{composer({ draft })}</StrictMode>)

      await waitFor(() => expect(textarea()).toHaveAttribute('readonly'))
      expect(textarea()).toHaveValue('First post')
      await postWhenReady()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toBe(key)
    })

    it('keeps working on the reopened record: edits update it in place and a post deletes it', async () => {
      const { draft } = await sendWithPhoto(new Error('lost response'))
      createNoteMock.mockClear()

      render(composer({ draft }))
      await waitFor(() => expect(textarea()).toHaveValue('First post'))
      type('First post, edited')
      await waitFor(async () => {
        const drafts = await storedDrafts()
        expect(drafts).toHaveLength(1)
        expect(drafts[0]).toMatchObject({
          id: draft.id,
          text: 'First post, edited',
          revision: draft.revision + 1
        })
      })

      await postWhenReady()
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(0), {
        timeout: 500
      })
    })

    it('enables Post for an unlocked draft under React StrictMode', async () => {
      const { draft } = await sendWithPhoto(new Error('lost response'))

      render(<StrictMode>{composer({ draft })}</StrictMode>)

      await waitFor(() => expect(textarea()).toHaveValue('First post'))
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
      )
    })

    it('uploads again only what never finished, from the kept bytes', async () => {
      const first = render(composer())
      uploadAttachmentMock.mockReturnValueOnce(new Promise(() => undefined))
      type('pending photo')
      attach('slow.png')
      await waitFor(async () => {
        const [draft] = await storedDrafts()
        expect(draft?.attachments[0]).toMatchObject({ hasBlob: true })
      })
      first.unmount()
      const [draft] = await storedDrafts()
      expect(draft.attachments[0].mediaId).toBeUndefined()
      uploadAttachmentMock.mockClear()

      render(composer({ draft }))

      await waitFor(() => expect(uploadAttachmentMock).toHaveBeenCalledTimes(1))
      expect(uploadAttachmentMock.mock.calls[0][0]).toMatchObject({
        name: 'slow.png'
      })
      await screen.findByRole('button', { name: 'Remove media slow.png' })
    })

    it('discarding a locked draft deletes the record only, never the kept media', async () => {
      const { draft } = await sendWithPhoto(new ApiRequestError('kept', 503))

      render(composer({ draft }))
      fireEvent.click(
        await screen.findByRole('button', { name: 'Discard draft' })
      )

      await waitFor(async () => expect(await storedDrafts()).toHaveLength(0))
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })
  })

  describe('after a post', () => {
    it('drops the draft and its bytes but not the media', async () => {
      render(composer())
      type('hello')
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(1))

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      // Released at once, not left for the next autosave (800 ms) to notice.
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(0), {
        timeout: 500
      })
      expect(await getDraftBlob('temp-0')).toBeUndefined()
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    })
  })

  describe('closing a quote', () => {
    it('keeps text worth keeping as a draft of the quote', async () => {
      const onDiscardQuote = vi.fn()
      render(composer({ quotedStatus: quoted, onDiscardQuote }))
      type('my take')
      await waitForSaved()

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss quote' }))

      expect(onDiscardQuote).toHaveBeenCalled()
      // Long enough for a discard to have finished deleting.
      await new Promise((resolve) => setTimeout(resolve, 150))
      const [draft] = await storedDrafts()
      expect(draft).toMatchObject({
        text: 'my take',
        quoteOf: { id: quoted.id }
      })
    })

    it('leaves nothing behind when it is empty', async () => {
      const onDiscardQuote = vi.fn()
      render(composer({ quotedStatus: quoted, onDiscardQuote }))

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss quote' }))

      expect(onDiscardQuote).toHaveBeenCalled()
      expect(await storedDrafts()).toHaveLength(0)
    })
  })

  it('counts the other drafts, not the one being typed, in the Drafts link', async () => {
    await saveDraft(
      {
        id: 'other',
        accountId: ACCOUNT_ID,
        actorId: profile.id,
        revision: 0,
        createdAt: 1,
        updatedAt: 1,
        composer: 'post-box',
        text: 'an older draft',
        contentWarning: '',
        contentWarningVisible: false,
        visibility: 'public',
        quoteApprovalPolicy: 'public',
        attachments: []
      },
      { expectedRevision: 0, epoch: 0 }
    )
    render(composer({ showDraftsLink: true }))

    const link = await screen.findByRole('link', { name: 'Open' })
    expect(link.parentElement).toHaveTextContent('1 draft · Open')
    expect(link).toHaveAttribute('href', '/drafts')

    type('a new one')
    await waitForSaved()
    await waitFor(async () => expect(await storedDrafts()).toHaveLength(2))
    expect(
      screen.getByRole('link', { name: 'Open' }).parentElement
    ).toHaveTextContent('1 draft · Open')
  })

  it('shows no Drafts link on a composer that did not ask for one', async () => {
    render(composer())
    type('hello')
    await waitForSaved()

    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull()
  })
})
