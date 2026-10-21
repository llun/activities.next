/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import { createNote, uploadAttachment } from '@/lib/client'
import {
  ApiRequestError,
  DRAFT_LOCKED_NOTICE,
  SESSION_EXPIRED_NOTICE
} from '@/lib/client/http'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import { isPublicId } from '@/lib/utils/publicId'
import { resizeImage } from '@/lib/utils/resizeImage'

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage')

const createNoteMock = createNote as jest.MockedFunction<typeof createNote>
const resizeImageMock = resizeImage as jest.MockedFunction<typeof resizeImage>

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

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
  createdAt: currentTime
}

const replyStatus: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
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
}

const uploadAttachmentMock = uploadAttachment as jest.MockedFunction<
  typeof uploadAttachment
>

describe('StatusReplyBox', () => {
  beforeEach(() => {
    createNoteMock.mockResolvedValue({
      status: replyStatus,
      attachments: []
    })
    uploadAttachmentMock.mockResolvedValue({
      id: 'att-1',
      type: 'upload',
      mediaType: 'image/png',
      url: 'https://activities.local/media/1.png',
      width: 100,
      height: 100
    })
    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `uuid-${counter++}` as never)
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not submit hidden content warning text', async () => {
    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Reply to Llun...'), {
      target: { value: 'Reply body' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add content warning' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Content warning' }), {
      target: { value: 'Spoilers' }
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove content warning' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contentWarning: undefined
        })
      )
    })
  })

  it('reuses the idempotencyKey when a failed reply is retried and mints a fresh key for the next reply', async () => {
    createNoteMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ status: replyStatus, attachments: [] })
    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('Reply to Llun...')
    fireEvent.change(textarea, { target: { value: 'Reply body' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const firstKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
    expect(isPublicId(firstKey!)).toBe(true)

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    expect(createNoteMock.mock.calls[1]?.[0]?.idempotencyKey).toBe(firstKey)

    fireEvent.change(textarea, { target: { value: 'Reply body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
    const nextKey = createNoteMock.mock.calls[2]?.[0]?.idempotencyKey
    expect(isPublicId(nextKey!)).toBe(true)
    expect(nextKey).not.toBe(firstKey)
  })

  it('mints a fresh idempotencyKey when a failed reply is edited before the retry', async () => {
    createNoteMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ status: replyStatus, attachments: [] })
    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('Reply to Llun...')
    fireEvent.change(textarea, { target: { value: 'Reply body' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const firstKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.change(textarea, { target: { value: 'Reply body, edited' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    const editedKey = createNoteMock.mock.calls[1]?.[0]?.idempotencyKey
    expect(isPublicId(editedKey!)).toBe(true)
    expect(editedKey).not.toBe(firstKey)
  })

  it.each([503, 409])(
    'locks the reply draft after a %i and retries the same payload under the same key',
    async (status) => {
      createNoteMock
        .mockRejectedValueOnce(new ApiRequestError('kept', status))
        .mockResolvedValue({ status: replyStatus, attachments: [] })
      render(
        <StatusReplyBox
          profile={profile}
          replyStatus={replyStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      )

      const textarea = screen.getByPlaceholderText('Reply to Llun...')
      fireEvent.change(textarea, { target: { value: 'Reply body' } })
      const postButton = screen.getByRole('button', { name: 'Post' })
      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      await waitFor(() => expect(postButton).toBeEnabled())
      expect(textarea).toHaveAttribute('readonly')
      expect(
        screen.getByRole('button', { name: 'Add content warning' })
      ).toBeDisabled()

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      const [first, retry] = createNoteMock.mock.calls.map(([call]) => call)
      expect(retry).toEqual(first)

      await waitFor(() => expect(textarea).toHaveValue(''))
      expect(textarea).not.toHaveAttribute('readonly')
      expect(
        screen.getByRole('button', { name: 'Add content warning' })
      ).toBeEnabled()
    }
  )

  const renderReplyBox = (target: StatusNote = replyStatus) => {
    const props = {
      profile,
      isMediaUploadEnabled: true,
      onCancel: vi.fn(),
      onPostCreated: vi.fn()
    }
    const view = render(<StatusReplyBox {...props} replyStatus={target} />)
    return {
      ...view,
      retarget: (next: StatusNote) =>
        view.rerender(<StatusReplyBox {...props} replyStatus={next} />)
    }
  }

  const lockReplyDraft = async () => {
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const view = renderReplyBox()
    const textarea = screen.getByPlaceholderText('Reply to Llun...')
    fireEvent.change(textarea, { target: { value: 'Reply body' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    await waitFor(() => expect(postButton).toBeEnabled())
    return { ...view, textarea, postButton }
  }

  it('announces the lock in a persistent status line', async () => {
    const { postButton } = await lockReplyDraft()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(
      "Your post was saved but couldn't be sent yet. Press Post again to retry."
    )
    expect(status).toHaveTextContent(DRAFT_LOCKED_NOTICE)

    // The line survives the retry attempt, unlike the alert.
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 409))
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Your post is still being sent.'
      )
    )
  })

  it('locks every control, including the attachment tiles', async () => {
    resizeImageMock.mockImplementation((file) => Promise.resolve(file))
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const alice = {
      ...profile,
      id: 'https://activities.local/users/alice',
      username: 'alice',
      name: 'Alice'
    }
    render(
      <StatusReplyBox
        profile={profile}
        isMediaUploadEnabled
        replyStatus={{
          ...replyStatus,
          id: 'https://activities.local/users/alice/statuses/post-lock',
          actorId: alice.id,
          actor: alice,
          summary: 'Spoiler',
          tags: [
            {
              id: 'tag-1',
              statusId: 'status-lock',
              type: 'mention',
              name: '@bob',
              value: 'https://activities.local/users/bob',
              createdAt: currentTime,
              updatedAt: currentTime
            }
          ]
        }}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )
    fireEvent.change(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      {
        target: {
          files: [new File(['image-bytes'], 'test.png', { type: 'image/png' })]
        }
      }
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Add media \(1\// })
      ).toBeInTheDocument()
    )
    const tile = document.querySelector<HTMLElement>('div.aspect-square')!
    expect(tile).not.toHaveAttribute('inert')
    expect(tile).toHaveClass('cursor-pointer')

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    // The tile is re-keyed once its upload resolves, so look it up again.
    const lockedTile = document.querySelector<HTMLElement>('div.aspect-square')!
    expect(lockedTile).toHaveAttribute('inert')
    expect(lockedTile).toHaveClass('cursor-default')
    expect(lockedTile).not.toHaveClass('cursor-pointer')
    // Removing a tile would change the payload, so a click does nothing.
    fireEvent.click(lockedTile)
    expect(document.querySelectorAll('div.aspect-square')).toHaveLength(1)
    for (const name of ['All (2)', 'Author first', 'Author only']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    expect(
      screen.getByRole('textbox', { name: 'Content warning' })
    ).toHaveAttribute('readonly')
    expect(
      screen.getByRole('button', { name: 'Remove content warning' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Add media \(1\// })
    ).toBeDisabled()
  })

  it.each([422, 400, 404, 500, 401, 403])(
    'does not lock the reply for a first failure of %i',
    async (status) => {
      createNoteMock.mockRejectedValueOnce(new ApiRequestError('no', status))
      renderReplyBox()
      const textarea = screen.getByPlaceholderText('Reply to Llun...')
      fireEvent.change(textarea, { target: { value: 'Reply body' } })
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(textarea).not.toHaveAttribute('readonly')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
  )

  it('discards a locked reply and its key on Cancel', async () => {
    const { textarea, postButton } = await lockReplyDraft()
    const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(textarea).not.toHaveAttribute('readonly')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    // The parent keeps the box open here, so the next reply needs a new key.
    fireEvent.change(textarea, { target: { value: 'Reply body' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    expect(createNoteMock.mock.calls[1]?.[0]?.idempotencyKey).not.toBe(
      lockedKey
    )
  })

  it('drops a media batch that lands after the reply locked', async () => {
    const resized = createDeferred<File>()
    resizeImageMock.mockReturnValueOnce(resized.promise)
    const { textarea, postButton } = await (async () => {
      createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
      renderReplyBox()
      const textarea = screen.getByPlaceholderText('Reply to Llun...')
      fireEvent.change(textarea, { target: { value: 'Reply body' } })
      const file = new File(['late'], 'late.png', { type: 'image/png' })
      fireEvent.change(
        document.querySelector<HTMLInputElement>('input[type="file"]')!,
        { target: { files: [file] } }
      )
      const postButton = screen.getByRole('button', { name: 'Post' })
      fireEvent.click(postButton)
      await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
      await act(async () => {
        resized.resolve(file)
        await resized.promise
      })
      return { textarea, postButton }
    })()

    expect(document.querySelectorAll('div.aspect-square')).toHaveLength(0)
    expect(textarea).toHaveAttribute('readonly')
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    const [first, retry] = createNoteMock.mock.calls.map(([call]) => call)
    expect(retry).toEqual(first)
  })

  it('unlocks when the reply target changes', async () => {
    const { textarea, retarget } = await lockReplyDraft()

    retarget({ ...replyStatus, id: `${replyStatus.id}-next` })

    await waitFor(() => expect(textarea).not.toHaveAttribute('readonly'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not lock the new reply when a kept failure lands after a re-target', async () => {
    const pending = createDeferred<never>()
    createNoteMock.mockReturnValueOnce(pending.promise)
    const { retarget } = renderReplyBox()
    fireEvent.change(screen.getByPlaceholderText('Reply to Llun...'), {
      target: { value: 'Reply body' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    retarget({ ...replyStatus, id: `${replyStatus.id}-next` })
    await act(async () => {
      pending.reject(new ApiRequestError('kept', 503))
      await pending.promise.catch(() => undefined)
    })

    // The failure belongs to the old reply: the new one shows nothing.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(document.querySelector('textarea')).not.toHaveAttribute('readonly')
  })

  it('unlocks a locked reply and mints a new key only when the retry gets a 410', async () => {
    {
      const { textarea, postButton } = await lockReplyDraft()
      const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
      createNoteMock.mockRejectedValueOnce(new ApiRequestError('gone', 410))

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(textarea).not.toHaveAttribute('readonly'))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      await waitFor(() => expect(postButton).toBeEnabled())

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      const nextKey = createNoteMock.mock.calls[2]?.[0]?.idempotencyKey
      expect(isPublicId(nextKey!)).toBe(true)
      expect(nextKey).not.toBe(lockedKey)
    }
  })

  it.each([
    ['a network error', () => new Error('offline'), 'offline'],
    ['a 429', () => new ApiRequestError('slow', 429), 'slow'],
    ['a 400', () => new ApiRequestError('Bad Request', 400), 'Bad Request'],
    ['a 422', () => new ApiRequestError('Too long', 422), 'Too long'],
    ['a 404', () => new ApiRequestError('Not found', 404), 'Not found']
  ])(
    'keeps a locked reply and its key and shows the message when the retry fails with %s',
    async (_name, makeError, message) => {
      const { textarea, postButton } = await lockReplyDraft()
      const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
      createNoteMock.mockRejectedValueOnce(makeError())

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(postButton).toBeEnabled())
      expect(textarea).toHaveAttribute('readonly')
      expect(screen.getByRole('status')).toHaveTextContent(message)

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      expect(createNoteMock.mock.calls[2]?.[0]?.idempotencyKey).toBe(lockedKey)
    }
  )

  it.each([401, 403])(
    'keeps the lock and key and asks to sign in again when the retry gets a %i',
    async (status) => {
      const { textarea, postButton } = await lockReplyDraft()
      const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
      createNoteMock.mockRejectedValueOnce(
        new ApiRequestError('The access token is invalid', status)
      )

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          SESSION_EXPIRED_NOTICE
        )
      )
      expect(textarea).toHaveAttribute('readonly')

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      expect(createNoteMock.mock.calls[2]?.[0]?.idempotencyKey).toBe(lockedKey)
    }
  )

  it('toggles mention modes between all, author-first, and author-only', async () => {
    const multiMentionStatus: StatusNote = {
      ...replyStatus,
      id: 'https://activities.local/users/alice/statuses/post-multi',
      actorId: 'https://activities.local/users/alice',
      actor: {
        id: 'https://activities.local/users/alice',
        username: 'alice',
        domain: 'activities.local',
        name: 'Alice',
        followersUrl: 'https://activities.local/users/alice/followers',
        inboxUrl: 'https://activities.local/users/alice/inbox',
        sharedInboxUrl: 'https://activities.local/inbox',
        followingCount: 0,
        followersCount: 0,
        statusCount: 0,
        lastStatusAt: null,
        createdAt: currentTime
      },
      tags: [
        {
          id: 'tag-1',
          statusId: 'status-multi',
          type: 'mention',
          name: '@bob',
          value: 'https://activities.local/users/bob',
          createdAt: currentTime,
          updatedAt: currentTime
        }
      ]
    }

    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={multiMentionStatus}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('Reply to Alice...')
    // By default mode is 'all'
    expect(textarea).toHaveValue(
      '@alice@activities.local @bob@activities.local '
    )

    // Switch to author-first
    fireEvent.click(screen.getByRole('button', { name: 'Author first' }))
    expect(textarea).toHaveValue(
      '@alice@activities.local \n\n@bob@activities.local'
    )

    // Switch to author-only
    fireEvent.click(screen.getByRole('button', { name: 'Author only' }))
    expect(textarea).toHaveValue('@alice@activities.local ')

    // Switch back to all
    fireEvent.click(screen.getByRole('button', { name: 'All (2)' }))
    expect(textarea).toHaveValue(
      '@alice@activities.local @bob@activities.local '
    )
  })

  it('previews the target status with its author and rendered mention links', () => {
    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={{
          ...replyStatus,
          isLocalActor: false,
          text: '<p><span class="h-card"><a href="https://remote.social/@bob" class="u-url mention">@<span>bob</span></a></span> hello there</p>'
        }}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    const preview = screen.getByTestId('reply-target-preview')
    expect(preview).toHaveTextContent('Replying to')
    expect(within(preview).getByRole('link', { name: 'Llun' })).toBeVisible()
    expect(within(preview).getByRole('link', { name: '@bob' })).toHaveAttribute(
      'href',
      '/@bob@remote.social'
    )
    expect(
      within(preview).getByTestId('reply-target-content')
    ).toHaveTextContent('@bob hello there')
  })

  it('inherits content warning and visibility from the target status', async () => {
    const parentStatusWithCwAndVisibility: StatusNote = {
      ...replyStatus,
      id: 'https://activities.local/users/alice/statuses/post-cw',
      actorId: 'https://activities.local/users/alice',
      actor: {
        id: 'https://activities.local/users/alice',
        username: 'alice',
        domain: 'activities.local',
        name: 'Alice',
        followersUrl: 'https://activities.local/users/alice/followers',
        inboxUrl: 'https://activities.local/users/alice/inbox',
        sharedInboxUrl: 'https://activities.local/inbox',
        followingCount: 0,
        followersCount: 0,
        statusCount: 0,
        lastStatusAt: null,
        createdAt: currentTime
      },
      summary: 'Spoiler Alert: Season Finale',
      to: ['https://activities.local/users/alice/followers'],
      cc: []
    }

    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={parentStatusWithCwAndVisibility}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    // Check CW input is visible and populated
    const cwInput = screen.getByRole('textbox', { name: 'Content warning' })
    expect(cwInput).toHaveValue('Spoiler Alert: Season Finale')

    fireEvent.change(screen.getByPlaceholderText('Reply to Alice...'), {
      target: { value: 'My reaction to the finale' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          contentWarning: 'Spoiler Alert: Season Finale',
          visibility: 'private',
          inReplyToId: parentStatusWithCwAndVisibility.id
        })
      )
    })
  })

  it.each([
    [
      503,
      "Your post was saved but couldn't be sent yet. Press Post again to retry."
    ],
    [409, 'Your post is still being sent. Please wait a moment.']
  ])('shows friendly copy when the server answers %i', async (status, copy) => {
    createNoteMock.mockRejectedValueOnce(
      new ApiRequestError('retry with the same Idempotency-Key', status)
    )
    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('Reply to Llun...'), {
      target: { value: 'Reply body' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(await screen.findByText(copy, { exact: false })).toBeInTheDocument()
    expect(
      screen.queryByText(/Idempotency-Key/, { exact: false })
    ).not.toBeInTheDocument()
  })

  it('preserves draft text and attachments on submit failure', async () => {
    resizeImageMock.mockImplementation((file) => Promise.resolve(file))
    createNoteMock.mockRejectedValueOnce(new Error('Network request failed'))

    render(
      <StatusReplyBox
        profile={profile}
        replyStatus={replyStatus}
        isMediaUploadEnabled={true}
        onCancel={vi.fn()}
        onPostCreated={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('Reply to Llun...')
    fireEvent.change(textarea, {
      target: { value: 'Important reply that must not be lost' }
    })

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['image-bytes'], 'test.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Add media \(1\// })
      ).toBeInTheDocument()
    })

    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(screen.getByText('Network request failed')).toBeInTheDocument()
      expect(postButton).toBeEnabled()
    })

    // Textarea still has the text
    expect(textarea).toHaveValue('Important reply that must not be lost')
    // Attachment still present
    expect(
      screen.getByRole('button', { name: /Add media \(1\// })
    ).toBeInTheDocument()
  })
})

// The reply endpoint enforces the resolved posts.maxCharacters, so the reply
// box has to count down from the same limit as the full composer — otherwise a
// reply drafted past a lowered limit only fails on submit.
describe('StatusReplyBox character counter', () => {
  beforeEach(() => {
    createNoteMock.mockResolvedValue({
      status: replyStatus,
      attachments: []
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const renderReplyBox = (maxStatusCharacters?: number) =>
    render(
      <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
        <StatusReplyBox
          profile={profile}
          replyStatus={replyStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

  it.each([
    {
      description: 'counts down from the default limit without a provider',
      maxStatusCharacters: undefined,
      text: 'hello',
      expectedRemaining: '495',
      expectedEnabled: true
    },
    {
      description: 'counts down from the instance-configured limit',
      maxStatusCharacters: 1000,
      text: 'a'.repeat(700),
      expectedRemaining: '300',
      expectedEnabled: true
    },
    {
      description: 'blocks a reply past a lowered instance limit',
      maxStatusCharacters: 100,
      text: 'a'.repeat(120),
      expectedRemaining: '-20',
      expectedEnabled: false
    }
  ])(
    '$description',
    ({ maxStatusCharacters, text, expectedRemaining, expectedEnabled }) => {
      renderReplyBox(maxStatusCharacters)

      fireEvent.change(screen.getByPlaceholderText('Reply to Llun...'), {
        target: { value: text }
      })

      expect(screen.getByText(expectedRemaining)).toBeInTheDocument()
      const postButton = screen.getByRole('button', { name: 'Post' })
      if (expectedEnabled) expect(postButton).toBeEnabled()
      else expect(postButton).toBeDisabled()
    }
  )
})

// The reply box's media picker dispatches straight to the reducer (no ref
// batching like the full composer), so its cap enforcement lives entirely in
// the addAttachment reducer guard, keyed on the instance's resolved
// posts.maxMediaAttachments passed at the dispatch call site.
describe('StatusReplyBox attachment cap', () => {
  beforeEach(() => {
    createNoteMock.mockResolvedValue({
      status: replyStatus,
      attachments: []
    })
    resizeImageMock.mockImplementation((file) => Promise.resolve(file))

    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `uuid-${counter++}` as never)
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('holds two overlapping picker batches to the configured cap', async () => {
    render(
      <InstanceLimitsProvider maxMediaAttachments={1}>
        <StatusReplyBox
          profile={profile}
          replyStatus={replyStatus}
          isMediaUploadEnabled={true}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]')!
    const fileA = new File(['a'], 'a.jpg', { type: 'image/jpeg' })
    const fileB = new File(['b'], 'b.jpg', { type: 'image/jpeg' })

    // Fire both picker batches back to back, before either's state update
    // commits: both read the same (still zero) attachment count and each
    // decide they have a free slot, so only the reducer's own cap check —
    // evaluated against the reducer's actual current state at dispatch time,
    // not either batch's stale read — can stop the second one from landing.
    fireEvent.change(input, { target: { files: [fileA] } })
    fireEvent.change(input, { target: { files: [fileB] } })

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Add media (1/1)' })
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: 'Add media (2/1)' })
    ).not.toBeInTheDocument()
  })
})

describe('StatusReplyBox automatic vertical growth', () => {
  it('updates measured height on input and shrinks back when cleared without field-sizing support', () => {
    const originalCSS = globalThis.CSS
    globalThis.CSS = {
      supports: vi.fn(() => false)
    } as unknown as typeof CSS

    try {
      render(
        <StatusReplyBox
          profile={profile}
          replyStatus={replyStatus}
          onCancel={vi.fn()}
          onPostCreated={vi.fn()}
        />
      )
      const textarea = screen.getByPlaceholderText(
        `Reply to ${replyStatus.actor?.name}...`
      ) as HTMLTextAreaElement

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 140
      })

      act(() => {
        fireEvent.change(textarea, {
          target: { value: 'A long reply spanning multiple lines' }
        })
      })

      expect(textarea.style.height).toBe('140px')

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 60
      })

      act(() => {
        fireEvent.change(textarea, { target: { value: '' } })
      })

      expect(textarea.style.height).toBe('60px')
    } finally {
      globalThis.CSS = originalCSS
    }
  })
})
