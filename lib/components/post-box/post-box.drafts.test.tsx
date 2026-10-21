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
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { StrictMode } from 'react'

import { deleteAccountMedia } from '@/lib/client'
import { resetConnectionForTesting } from '@/lib/client/connection'
import {
  type DraftRecord,
  getDraftBlob,
  listDrafts,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { ApiRequestError } from '@/lib/client/http'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'
import { Status, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'
import {
  attach,
  createNoteMock,
  profile,
  resetPostBoxMediaMocks,
  uploadAttachmentMock
} from './post-box-media.testUtils'

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

      expect(deleteAccountMedia).not.toHaveBeenCalled()
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

      expect(deleteAccountMedia).not.toHaveBeenCalled()
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

      expect(deleteAccountMedia).toHaveBeenCalledWith({
        mediaId: 'media-a.png'
      })
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

      expect(deleteAccountMedia).toHaveBeenCalledWith({
        mediaId: 'media-a.png'
      })
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

  describe('the Alert', () => {
    it('shows a failed send after the composer card, never through window.alert', async () => {
      failOnce(new Error('The server said no'))
      const { container } = render(composer({ frameClassName: 'card' }))
      type('hello')
      await waitForSaved()

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      const alert = await screen.findByRole('alert')
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

      const alert = await screen.findByRole('alert')
      expect(alert.parentElement).not.toHaveClass('max-md:pb-6')
    })

    it('retries from the Alert under the same key', async () => {
      failOnce(new Error('offline'))
      render(composer())
      type('hello')
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await screen.findByRole('alert')

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      expect(createNoteMock.mock.calls[1][0].idempotencyKey).toBe(
        createNoteMock.mock.calls[0][0].idempotencyKey
      )
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    })

    it('says nothing but the lock line when the server kept the post', async () => {
      failOnce(new ApiRequestError('kept', 503))
      render(composer())
      type('hello')

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      expect(await screen.findByText(/Editing is locked/)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()
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

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('nothing was sent')
      expect(createNoteMock).not.toHaveBeenCalled()
      expect(screen.getByText('Not saved, copy your text')).toBeVisible()
      expect(textarea()).not.toHaveAttribute('readonly')
    })

    it('sends once the checkpoint can be written again', async () => {
      await saveThenFailToCheckpoint()
      const full = makeFull()
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))
      await screen.findByRole('alert')
      full.mockRestore()

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
      expect(createNoteMock.mock.calls[0][0].idempotencyKey).toEqual(
        expect.any(String)
      )
    })

    it('does not send after another tab changed the draft', async () => {
      await saveThenFailToCheckpoint()
      const [draft] = await storedDrafts()
      await saveDraft(
        { ...draft, text: 'written in another tab' },
        { expectedRevision: draft.revision, epoch: 0 }
      )

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'nothing was sent'
      )
      expect(createNoteMock).not.toHaveBeenCalled()
      expect((await storedDrafts())[0].text).toBe('written in another tab')
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
      await screen.findByRole('alert')

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
        await screen.findByRole('alert')
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
      expect(deleteAccountMedia).not.toHaveBeenCalled()
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
      expect(deleteAccountMedia).not.toHaveBeenCalled()
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
      expect(deleteAccountMedia).not.toHaveBeenCalled()
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
