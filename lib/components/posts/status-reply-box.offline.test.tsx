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

import { createNote, uploadAttachment } from '@/lib/client'
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
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { resizeImage } from '@/lib/utils/resizeImage'

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/client/health', () => ({ checkServerHealth: vi.fn() }))

vi.mock('@/lib/utils/resizeImage')

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn().mockResolvedValue(undefined)
}))

// The save of a hand-off is the one thing a test needs to hold in flight.
vi.mock('@/lib/client/drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/drafts')>()
  return { ...actual, saveDraft: vi.fn(actual.saveDraft) }
})

const actualSaveDraft = (
  await vi.importActual<typeof import('@/lib/client/drafts')>(
    '@/lib/client/drafts'
  )
).saveDraft

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

const otherStatus = { ...replyStatus, id: `${replyStatus.id}-other` }

const bobStatus = {
  ...replyStatus,
  actorId: 'https://activities.local/users/bob',
  actor: {
    ...profile,
    id: 'https://activities.local/users/bob',
    username: 'bob',
    name: 'Bob'
  }
} as unknown as StatusNote

const ACCOUNT_ID = 'account-1'

const box = (
  status: StatusNote,
  onCancel: () => void = vi.fn(),
  isMediaUploadEnabled = true
) => (
  <DraftsProvider accountId={ACCOUNT_ID} actorId={profile.id}>
    <StatusReplyBox
      profile={profile}
      replyStatus={status}
      isMediaUploadEnabled={isMediaUploadEnabled}
      onCancel={onCancel}
      onPostCreated={vi.fn()}
    />
  </DraftsProvider>
)

const textarea = () =>
  screen.getByPlaceholderText(/^Reply to/) as HTMLTextAreaElement
const type = (value: string) =>
  fireEvent.change(textarea(), { target: { value } })
const stored = () => listDrafts({ actorId: profile.id })

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

const attachPhoto = (name: string, type = 'image/png') =>
  fireEvent.change(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    {
      target: { files: [new File([name], name, { type })] }
    }
  )

// Real IndexedDB plus a loaded machine: the 1 s default is too tight.
configure({ asyncUtilTimeout: 4000 })

describe('StatusReplyBox offline hand-off', () => {
  beforeEach(() => {
    resetConnectionForTesting()
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.mocked(saveDraft).mockImplementation(actualSaveDraft)
    vi.mocked(checkServerHealth).mockReset()
    vi.mocked(createNote).mockReset()
    vi.mocked(uploadAttachment).mockReset()
    vi.mocked(resizeImage).mockImplementation((file) => Promise.resolve(file))
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = vi.fn()
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
      render(box(replyStatus))

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
      render(box(replyStatus))

      await goOffline()

      expect(screen.queryByRole('button', { name: 'Post' })).toBeNull()
      expect(saveDraftButton()).toBeInTheDocument()
      expect(queueButton()).toBeInTheDocument()
      expect(screen.getByText(new RegExp(caption))).toBeInTheDocument()
      // No poll in a reply.
      expect(screen.queryByText(/The poll's duration/)).toBeNull()
    })

    it('goes back to Post when the connection returns', async () => {
      render(box(replyStatus))
      await goOffline()

      await goOnline()

      expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
    })

    it('explains why a video cannot be queued, and still lets it be saved', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      type('with a clip')
      attachPhoto('clip.mp4', 'video/mp4')
      await waitFor(() =>
        expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
      )

      expect(queueButton()).toHaveAttribute('aria-disabled', 'true')
      expect(queueButton()).toHaveAccessibleDescription(
        "Videos stay as drafts. Post this when you're back online."
      )
      fireEvent.click(queueButton())
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(onCancel).not.toHaveBeenCalled()

      fireEvent.click(saveDraftButton())
      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      expect((await stored())[0].queue).toBeUndefined()
    })
  })

  describe('Cmd/Ctrl+Enter', () => {
    const shortcut = () =>
      fireEvent.keyDown(textarea(), {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true
      })

    it('queues the reply instead of sending it live', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('from the keyboard')

      shortcut()

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      expect((await stored())[0].queue).toMatchObject({ state: 'waiting' })
      expect(createNote).not.toHaveBeenCalled()
    })

    it('queues on an implicit form submit too (Enter in the content warning)', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('submitted by the form')

      // jsdom has no implicit submission: submit the form as Enter would.
      fireEvent.submit(textarea().closest('form')!)

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      expect((await stored())[0].queue).toMatchObject({ state: 'waiting' })
      expect(createNote).not.toHaveBeenCalled()
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
        const onCancel = vi.fn()
        render(box(replyStatus, onCancel))
        await goOffline()
        type('with a clip')
        attachPhoto('clip.mp4', 'video/mp4')
        await waitFor(() =>
          expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
        )
        await screen.findByText('Saved on this device', {}, { timeout: 4000 })

        submit()

        await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
        expect((await stored())[0].queue).toBeUndefined()
        expect(createNote).not.toHaveBeenCalled()
      }
    )
  })

  it('does nothing on an implicit submit while the buttons are disabled (over the limit)', async () => {
    const onCancel = vi.fn()
    render(box(replyStatus, onCancel))
    await goOffline()
    attachPhoto('clip.mp4', 'video/mp4')
    await typeAndWaitForSave('x'.repeat(5000))

    expect(fireEvent.submit(textarea().closest('form')!)).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(onCancel).not.toHaveBeenCalled()
  })

  describe('Send when online', () => {
    it('stores a waiting record for the reply and closes the box', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('Reply body')

      fireEvent.click(queueButton())

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      const [draft] = await stored()
      expect(draft).toMatchObject({
        composer: 'reply-box',
        text: 'Reply body',
        replyTo: expect.objectContaining({ id: replyStatus.id }),
        queue: { state: 'waiting', attempts: 0 }
      })
      expect(
        await screen.findByText("Will send when you're back online")
      ).toBeVisible()
      expect(createNote).not.toHaveBeenCalled()
    })

    it('stores a photo as bytes, never uploading it', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      type('Reply with a photo')
      attachPhoto('a.png')
      await waitFor(() =>
        expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
      )
      await screen.findByText('Saved on this device', {}, { timeout: 4000 })

      fireEvent.click(queueButton())

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      const [draft] = await stored()
      expect(draft.queue).toBeDefined()
      expect(draft.attachments).toEqual([
        expect.objectContaining({ mediaId: undefined, hasBlob: true })
      ])
      expect(uploadAttachment).not.toHaveBeenCalled()
    })

    it('keeps the text and says so when the draft cannot be stored', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('keep me')
      const gate = failNextSave()

      fireEvent.click(queueButton())
      gate.resolve()

      expect(await findSendAlert()).toHaveTextContent(
        "Your draft couldn't be saved on this device"
      )
      expect(textarea()).toHaveValue('keep me')
      expect(onCancel).not.toHaveBeenCalled()
      expect((await stored())[0].queue).toBeUndefined()
    })

    it('does nothing for the mention pre-fill alone', async () => {
      const onCancel = vi.fn()
      render(box(bobStatus, onCancel))
      await screen.findByDisplayValue(/@bob/)
      await goOffline()

      fireEvent.click(queueButton())
      fireEvent.click(saveDraftButton())
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(await stored()).toHaveLength(0)
      expect(onCancel).not.toHaveBeenCalled()
      expect(textarea().value).toMatch(/@bob/)
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('only one hand-off runs at a time', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('once')
      const gate = holdNextSave()

      fireEvent.click(queueButton())
      fireEvent.click(queueButton())
      fireEvent.click(saveDraftButton())
      gate.resolve()

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      // The autosave, and the one hand-off.
      expect(saveDraft).toHaveBeenCalledTimes(2)
    })
  })

  describe('Save draft', () => {
    it('stores a draft without a queue and closes the box', async () => {
      const onCancel = vi.fn()
      render(box(replyStatus, onCancel))
      await goOffline()
      await typeAndWaitForSave('for later')

      fireEvent.click(saveDraftButton())

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1))
      const [draft] = await stored()
      expect(draft.text).toBe('for later')
      expect(draft.queue).toBeUndefined()
      expect(await screen.findByText('Saved to Drafts')).toBeVisible()
    })
  })

  describe('re-targeted during a hand-off', () => {
    it('finishes the hand-off for its own target, then moves to the new one', async () => {
      const { rerender } = render(box(replyStatus))
      await goOffline()
      await typeAndWaitForSave('Reply body')
      const gate = holdNextSave()

      fireEvent.click(queueButton())
      rerender(box(otherStatus))
      // Still the hand-off's own box until it settles.
      expect(textarea()).toHaveValue('Reply body')
      gate.resolve()

      await waitFor(() => expect(textarea()).not.toHaveValue('Reply body'))
      const drafts = await stored()
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({
        text: 'Reply body',
        replyTo: expect.objectContaining({ id: replyStatus.id }),
        queue: { state: 'waiting' }
      })
      // Handed off: nothing is kept a second time on the way to the new target.
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(screen.queryByText('Saved to Drafts')).toBeNull()
      // The autosave, and the one hand-off.
      expect(saveDraft).toHaveBeenCalledTimes(2)
    })

    it('keeps a failed hand-off first, and holds the guard while it does', async () => {
      const { rerender } = render(box(replyStatus))
      await goOffline()
      await typeAndWaitForSave('Reply body')
      // More text than the autosave holds, so the keep has something to save.
      type('Reply body, more')
      const failing = failNextSave()

      fireEvent.click(queueButton())
      rerender(box(otherStatus))
      // The keep that follows the failure is the third save: hold it open.
      const keeping = holdNextSave()
      failing.resolve()
      // The autosave, the failed hand-off, then the keep.
      await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(3))

      // Guard held while the keep runs: a click starts no further save.
      fireEvent.click(saveDraftButton())
      fireEvent.click(queueButton())
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(saveDraft).toHaveBeenCalledTimes(3)
      expect(textarea()).toHaveValue('Reply body, more')

      keeping.resolve()
      await waitFor(() =>
        expect(textarea()).not.toHaveValue('Reply body, more')
      )
      expect(await screen.findByText('Saved to Drafts')).toBeVisible()
      const [draft] = await stored()
      expect(draft).toMatchObject({
        text: 'Reply body, more',
        replyTo: expect.objectContaining({ id: replyStatus.id })
      })
      expect(draft.queue).toBeUndefined()
    })
  })
})
