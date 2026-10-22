/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

import {
  deleteAccountMedia,
  deleteUnpostedMedia,
  uploadAttachment
} from '@/lib/client'
import { probeNow, resetConnectionForTesting } from '@/lib/client/connection'
import {
  listDrafts,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { checkServerHealth } from '@/lib/client/health'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { createDeferred } from '@/lib/testing/deferred'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'
import { findSendAlert } from '@/lib/testing/sendAlerts'
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

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn().mockResolvedValue(undefined)
}))

// The save of a hand-off is the one thing a test needs to hold in flight.
vi.mock('@/lib/client/drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/drafts')>()
  return { ...actual, saveDraft: vi.fn(actual.saveDraft) }
})

const ACCOUNT_ID = 'account-1'
const actualSaveDraft = (
  await vi.importActual<typeof import('@/lib/client/drafts')>(
    '@/lib/client/drafts'
  )
).saveDraft

const replyTo = (id: string) =>
  ({
    id: `https://activities.local/users/bob/statuses/${id}`,
    actorId: 'https://activities.local/users/bob',
    actor: {
      id: 'https://activities.local/users/bob',
      username: 'bob',
      domain: 'activities.local',
      name: 'Bob'
    },
    type: StatusType.enum.Note,
    text: 'a post',
    tags: [],
    to: [],
    cc: []
  }) as unknown as Status

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

const type = (value: string) =>
  fireEvent.change(textarea(), { target: { value } })

const storedDrafts = () => listDrafts({ actorId: profile.id })

// The provider reads its epoch after mounting; nothing can be saved before it
// has, so wait for the autosave to land first.
const typeAndWaitForSave = async (value: string) => {
  type(value)
  await screen.findByText('Saved on this device', {}, { timeout: 4000 })
}

const goOffline = async () => {
  vi.mocked(checkServerHealth).mockResolvedValue(false)
  await act(async () => {
    await probeNow()
  })
}

const goOnline = async () => {
  vi.mocked(checkServerHealth).mockResolvedValue(true)
  await act(async () => {
    await probeNow()
  })
}

const saveDraftButton = () => screen.getByRole('button', { name: 'Save draft' })
const queueButton = () =>
  screen.getByRole('button', { name: 'Send when online' })

// Holds the next save open; `finish` lets it through, `fail` rejects it.
const holdNextSave = () => {
  const gate = createDeferred<void>()
  vi.mocked(saveDraft).mockImplementationOnce(async (...args) => {
    await gate.promise
    return actualSaveDraft(...args)
  })
  return gate
}

const failNextSave = () => {
  const gate = createDeferred<void>()
  vi.mocked(saveDraft).mockImplementationOnce(async () => {
    await gate.promise
    throw new Error('disk full')
  })
  return gate
}

// Real IndexedDB plus a loaded machine: the 1 s default is too tight.
configure({ asyncUtilTimeout: 4000 })

describe('PostBox offline hand-off', () => {
  beforeEach(() => {
    resetPostBoxMediaMocks()
    resetConnectionForTesting()
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.mocked(saveDraft).mockImplementation(actualSaveDraft)
    vi.mocked(checkServerHealth).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetConnectionForTesting()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
  })

  describe('the buttons', () => {
    it('keeps Post while online', () => {
      render(composer())

      expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    })

    it.each([
      ['unreachable', "Can't reach the server."],
      ['offline', "You're offline."]
    ])('swaps Post for the split while %s', async (state, caption) => {
      if (state === 'offline') {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      }
      render(composer())

      await goOffline()

      expect(screen.queryByRole('button', { name: 'Post' })).toBeNull()
      expect(saveDraftButton()).toBeInTheDocument()
      expect(queueButton()).toBeInTheDocument()
      expect(screen.getByText(new RegExp(caption))).toBeInTheDocument()
    })

    it('goes back to Post when the connection returns', async () => {
      render(composer())
      await goOffline()

      await goOnline()

      expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    })

    it('keeps Update when editing a published post', async () => {
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

      await goOffline()

      expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
    })

    it('has both buttons disabled for an untouched composer and writes nothing', async () => {
      render(composer())
      await goOffline()

      expect(saveDraftButton()).toBeDisabled()
      expect(queueButton()).toBeDisabled()
      fireEvent.click(saveDraftButton())
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(await storedDrafts()).toHaveLength(0)
    })

    it('adds the poll line to the caption with a poll', async () => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      render(composer())
      await goOffline()
      expect(screen.queryByText(/The poll's duration/)).toBeNull()

      await choosePostOption('Poll')

      expect(
        await screen.findByText(/The poll's duration starts when it's sent\./)
      ).toBeInTheDocument()
    })

    it('explains why a video cannot be queued, and still lets it be saved', async () => {
      render(composer())
      await goOffline()
      const fileInput = document.querySelector<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )!
      fireEvent.change(fileInput, {
        target: {
          files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })]
        }
      })
      await screen.findByRole('button', { name: 'Remove media clip.mp4' })

      expect(queueButton()).toHaveAttribute('aria-disabled', 'true')
      expect(queueButton()).toHaveAccessibleDescription(
        "Videos stay as drafts. Post this when you're back online."
      )
      fireEvent.click(queueButton())
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(await storedDrafts()).toHaveLength(0)

      fireEvent.click(saveDraftButton())
      await waitFor(async () => expect(await storedDrafts()).toHaveLength(1))
      expect((await storedDrafts())[0].queue).toBeUndefined()
    })
  })

  describe('Send when online', () => {
    it('stores a waiting record, clears the composer and keeps the uploaded media', async () => {
      const onHandedOff = vi.fn()
      const view = render(composer({ onHandedOff }))
      attach('a.png')
      await screen.findByText('Review')
      await goOffline()
      await typeAndWaitForSave('with a photo')

      fireEvent.click(queueButton())

      await waitFor(() => expect(onHandedOff).toHaveBeenCalledTimes(1))
      const [draft] = await storedDrafts()
      expect(draft).toMatchObject({
        text: 'with a photo',
        composer: 'post-box',
        queue: { state: 'waiting', attempts: 0 },
        attachments: [expect.objectContaining({ mediaId: 'media-a.png' })]
      })
      expect(textarea()).toHaveValue('')
      expect(
        await screen.findByText("Will send when you're back online")
      ).toBeVisible()
      // The queued record owns the photo: neither the hand-off nor leaving the
      // composer deletes it.
      view.unmount()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      expect(deleteAccountMedia).not.toHaveBeenCalled()
      expect(createNoteMock).not.toHaveBeenCalled()
      expect(await storedDrafts()).toHaveLength(1)
    })

    it('queues a poll with its choices', async () => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        }
      )
      render(composer())
      await goOffline()
      await typeAndWaitForSave('which one?')
      await choosePostOption('Poll')
      const first = await screen.findByPlaceholderText('Choice 1')
      const second = screen.getByPlaceholderText('Choice 2')
      fireEvent.change(first, { target: { value: 'one' } })
      fireEvent.change(second, { target: { value: 'two' } })

      fireEvent.click(queueButton())

      await waitFor(async () => expect(await storedDrafts()).toHaveLength(1))
      expect((await storedDrafts())[0]).toMatchObject({
        text: 'which one?',
        queue: { state: 'waiting' },
        poll: { choices: ['one', 'two'] }
      })
    })

    it('only one hand-off runs at a time', async () => {
      render(composer())
      await goOffline()
      await typeAndWaitForSave('once')
      const gate = holdNextSave()

      fireEvent.click(queueButton())
      fireEvent.click(queueButton())
      fireEvent.click(saveDraftButton())
      gate.resolve()

      await waitFor(async () => expect(await storedDrafts()).toHaveLength(1))
      await waitFor(() => expect(textarea()).toHaveValue(''))
      // The autosave, and the one hand-off.
      expect(saveDraft).toHaveBeenCalledTimes(2)
    })

    it('keeps the text and says so when the draft cannot be stored', async () => {
      const onHandedOff = vi.fn()
      render(composer({ onHandedOff }))
      await goOffline()
      await typeAndWaitForSave('keep me')
      const gate = failNextSave()

      fireEvent.click(queueButton())
      gate.resolve()

      expect(await findSendAlert()).toHaveTextContent("Couldn't queue.")
      expect(textarea()).toHaveValue('keep me')
      expect(onHandedOff).not.toHaveBeenCalled()
      // Only the autosave landed: nothing was queued.
      expect((await storedDrafts())[0].queue).toBeUndefined()
    })
  })

  describe('Cmd/Ctrl+Enter', () => {
    const shortcut = () =>
      fireEvent.keyDown(textarea(), {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true
      })

    it('queues the post instead of sending it live', async () => {
      render(composer())
      await goOffline()
      await typeAndWaitForSave('from the keyboard')

      shortcut()

      await waitFor(async () =>
        expect((await storedDrafts())[0].queue).toMatchObject({
          state: 'waiting'
        })
      )
      expect(createNoteMock).not.toHaveBeenCalled()
      await waitFor(() => expect(textarea()).toHaveValue(''))
    })

    it('queues on an implicit form submit too (Enter in the content warning)', async () => {
      render(composer())
      await goOffline()
      await typeAndWaitForSave('submitted by the form')

      // jsdom has no implicit submission: submit the form as Enter would.
      fireEvent.submit(textarea().closest('form')!)

      await waitFor(async () =>
        expect((await storedDrafts())[0].queue).toMatchObject({
          state: 'waiting'
        })
      )
      expect(createNoteMock).not.toHaveBeenCalled()
    })

    it.each([
      ['the shortcut', () => shortcut()],
      [
        'an implicit form submit',
        () => {
          // Default prevented: no native navigation away from the page.
          expect(fireEvent.submit(textarea().closest('form')!)).toBe(false)
        }
      ]
    ])(
      'saves a draft when the queue is unavailable (video), from %s',
      async (_how, submit) => {
        const onHandedOff = vi.fn()
        render(composer({ onHandedOff }))
        await goOffline()
        const fileInput = document.querySelector<HTMLInputElement>(
          'input[type="file"][name="file"]'
        )!
        fireEvent.change(fileInput, {
          target: {
            files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })]
          }
        })
        await screen.findByRole('button', { name: 'Remove media clip.mp4' })
        await screen.findByText('Saved on this device', {}, { timeout: 4000 })

        submit()

        await waitFor(() => expect(onHandedOff).toHaveBeenCalledTimes(1))
        expect(await storedDrafts()).toHaveLength(1)
        expect((await storedDrafts())[0].queue).toBeUndefined()
        expect(createNoteMock).not.toHaveBeenCalled()
      }
    )
  })

  it('does nothing on an implicit submit while the buttons are disabled (over the limit)', async () => {
    const onHandedOff = vi.fn()
    render(composer({ onHandedOff }))
    await goOffline()
    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"][name="file"]'
    )!
    fireEvent.change(fileInput, {
      target: { files: [new File(['v'], 'clip.mp4', { type: 'video/mp4' })] }
    })
    await screen.findByRole('button', { name: 'Remove media clip.mp4' })
    await typeAndWaitForSave('x'.repeat(5000))
    expect(saveDraftButton()).toBeDisabled()

    expect(fireEvent.submit(textarea().closest('form')!)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onHandedOff).not.toHaveBeenCalled()
  })

  describe('an untouched composer', () => {
    it('hands nothing off: a reply holding only its mention writes no record', async () => {
      const onHandedOff = vi.fn()
      render(composer({ replyStatus: replyTo('first'), onHandedOff }))
      await screen.findByDisplayValue(/@bob/)
      await goOffline()
      // Typed over and back: the buttons are live (there is text), yet nothing
      // differs from the pre-fill.
      const prefill = textarea().value
      type(`${prefill}x`)
      type(prefill)
      expect(saveDraftButton()).toBeEnabled()

      fireEvent.click(queueButton())
      fireEvent.click(saveDraftButton())
      await new Promise((resolve) => setTimeout(resolve, 100))
      // Nothing was tried, so nothing failed either.
      expect(screen.queryByRole('alert')).toBeNull()
      expect(await storedDrafts()).toHaveLength(0)
      expect(onHandedOff).not.toHaveBeenCalled()
    })
  })

  describe('Save draft', () => {
    it('stores a draft without a queue and clears the composer', async () => {
      const onHandedOff = vi.fn()
      render(composer({ onHandedOff }))
      await goOffline()
      await typeAndWaitForSave('for later')

      fireEvent.click(saveDraftButton())

      await waitFor(() => expect(onHandedOff).toHaveBeenCalledTimes(1))
      const [draft] = await storedDrafts()
      expect(draft.text).toBe('for later')
      expect(draft.queue).toBeUndefined()
      expect(textarea()).toHaveValue('')
      expect(await screen.findByText('Saved to Drafts')).toBeVisible()
    })
  })

  describe('re-targeted during a hand-off', () => {
    it('finishes the hand-off for its own target, then moves to the new one', async () => {
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      await goOffline()
      await typeAndWaitForSave('@bob@activities.local my reply')
      const gate = holdNextSave()

      fireEvent.click(queueButton())
      rerender(composer({ replyStatus: replyTo('second') }))
      // Still the hand-off's own composer until it settles.
      expect(textarea().value).toBe('@bob@activities.local my reply')
      gate.resolve()

      await waitFor(() => expect(textarea().value).not.toContain('my reply'))
      const drafts = await storedDrafts()
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({
        text: '@bob@activities.local my reply',
        replyTo: expect.objectContaining({ id: replyTo('first').id }),
        queue: { state: 'waiting' }
      })
      // Handed off: nothing is kept a second time on the way to the new target.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      // The autosave, and the one hand-off.
      expect(saveDraft).toHaveBeenCalledTimes(2)
    })

    it('keeps a failed hand-off first, and holds the guard while it does', async () => {
      const { rerender } = render(composer({ replyStatus: replyTo('first') }))
      await screen.findByDisplayValue(/@bob/)
      await goOffline()
      await typeAndWaitForSave('@bob@activities.local my reply')
      // More text than the autosave holds, so the keep has something to save.
      type('@bob@activities.local my reply, more')
      const failing = failNextSave()

      fireEvent.click(queueButton())
      rerender(composer({ replyStatus: replyTo('second') }))
      // The keep that follows the failure is the second save: hold it open.
      const keeping = holdNextSave()
      failing.resolve()
      // The autosave, the failed hand-off, then the keep.
      await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(3))

      // Guard held while the keep runs: a click starts no further save.
      fireEvent.click(saveDraftButton())
      fireEvent.click(queueButton())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(saveDraft).toHaveBeenCalledTimes(3)
      expect(textarea().value).toBe('@bob@activities.local my reply, more')

      keeping.resolve()
      await waitFor(() => expect(textarea().value).not.toContain('my reply'))
      expect(await screen.findByText('Saved to Drafts')).toBeVisible()
      const [draft] = await storedDrafts()
      expect(draft).toMatchObject({
        text: '@bob@activities.local my reply, more',
        replyTo: expect.objectContaining({ id: replyTo('first').id })
      })
      expect(draft.queue).toBeUndefined()
    })
  })

  describe('uploads while offline', () => {
    it('defers an upload, then starts it when the connection returns', async () => {
      render(composer())
      await goOffline()

      attach('a.png')

      await screen.findByRole('button', { name: 'Remove media a.png' })
      expect(uploadAttachment).not.toHaveBeenCalled()
      expect(screen.queryByText('Uploading…')).toBeNull()
      expect(screen.queryByText(/failed/i)).toBeNull()

      uploadAttachmentMock.mockResolvedValue(uploaded('media-a.png', 'a.png'))
      await goOnline()

      await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(1))
      expect(vi.mocked(uploadAttachment).mock.calls[0][0]).toMatchObject({
        name: 'a.png'
      })
      await screen.findByText('Review')
    })

    it('does not upload the deferred photo after it is queued', async () => {
      render(composer())
      await goOffline()
      attach('a.png')
      await screen.findByRole('button', { name: 'Remove media a.png' })
      await typeAndWaitForSave('with a photo')

      fireEvent.click(queueButton())
      await waitFor(async () =>
        expect((await storedDrafts())[0]?.queue).toBeDefined()
      )
      await goOnline()

      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(uploadAttachment).not.toHaveBeenCalled()
      const [draft] = await storedDrafts()
      expect(draft.attachments).toEqual([
        expect.objectContaining({ mediaId: undefined, hasBlob: true })
      ])
    })
  })
})
