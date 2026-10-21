/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { deleteAccountMedia, getCustomEmojis } from '@/lib/client'
import {
  ApiRequestError,
  DRAFT_LOCKED_NOTICE,
  SESSION_EXPIRED_NOTICE
} from '@/lib/client/http'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { createDeferred } from '@/lib/testing/deferred'
import { Status, StatusType } from '@/lib/types/domain/status'
import { isPublicId } from '@/lib/utils/publicId'

import { PostBox } from './post-box'
import {
  choosePostOption,
  createNoteMock,
  createPollMock,
  editStatus,
  expectPostOptionsLocked,
  profile,
  resetEditMediaMocks,
  resizeImageMock,
  uploadAttachmentMock
} from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  deleteFitnessFile: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGallerySettings: vi.fn().mockResolvedValue({
    allowEmptyDescription: true,
    altTextAvailable: false
  }),
  getMedia: vi.fn().mockRejectedValue(new Error('details unavailable')),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

describe('PostBox media-only and reply posts', () => {
  beforeEach(() => {
    resetEditMediaMocks()
  })

  it('enables and submits a media-only new post', async () => {
    render(
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

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
      expect(
        screen.getByRole('button', { name: 'Remove media replacement.png' })
      ).toBeInTheDocument()
    })

    fireEvent.click(postButton)

    await waitFor(() => {
      expect(uploadAttachmentMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'replacement.png' })
      )
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          quoteApprovalPolicy: 'public',
          attachments: [
            expect.objectContaining({
              id: 'uploaded-media',
              name: 'replacement.png'
            })
          ]
        })
      )
    })
  })

  it('keeps post button disabled when replying to own status with empty content', async () => {
    const ownStatus = {
      id: 'https://activities.local/users/llun/statuses/own-1',
      url: 'https://activities.local/@llun/own-1',
      actorId: profile.id,
      actor: profile,
      type: StatusType.enum.Note,
      text: 'my own post',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        replyStatus={ownStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textbox = screen.getByPlaceholderText('What is on your mind?')
    expect(textbox).toHaveValue('')
    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()
  })

  it('keeps a new post with media enabled when text is cleared', async () => {
    render(
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

    const postButton = screen.getByRole('button', { name: 'Post' })
    const textbox = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textbox, { target: { value: 'caption' } })

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
    })

    fireEvent.change(textbox, { target: { value: '' } })

    expect(postButton).toBeEnabled()
  })

  it('disables a new post when the only media is removed', async () => {
    render(
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

    const postButton = screen.getByRole('button', { name: 'Post' })
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['replacement'], 'replacement.png', { type: 'image/png' })
        ]
      }
    })

    await waitFor(() => {
      expect(postButton).toBeEnabled()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove media replacement.png' })
    )

    expect(postButton).toBeDisabled()
  })
})

describe('PostBox markdown preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders custom emoji shortcodes as inline images in the preview', async () => {
    ;(getCustomEmojis as jest.Mock).mockResolvedValueOnce([
      {
        shortcode: 'blobcat',
        url: 'https://activities.local/emojis/blobcat.png',
        static_url: 'https://activities.local/emojis/blobcat.png',
        visible_in_picker: true,
        category: null
      }
    ])

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'hi :blobcat:' } })
    await choosePostOption('Preview')

    const image = await screen.findByAltText(':blobcat:')
    expect(image).toHaveAttribute(
      'src',
      'https://activities.local/emojis/blobcat.png'
    )
  })

  it('renders custom emoji shortcodes in content warning preview', async () => {
    ;(getCustomEmojis as jest.Mock).mockResolvedValueOnce([
      {
        shortcode: 'blobcat',
        url: 'https://activities.local/emojis/blobcat.png',
        static_url: 'https://activities.local/emojis/blobcat.png',
        visible_in_picker: true,
        category: null
      }
    ])

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    await choosePostOption('Content warning')
    const cwInput = screen.getByPlaceholderText('Write your warning here')
    fireEvent.change(cwInput, { target: { value: 'CW :blobcat:' } })
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'hidden secret' } })
    await choosePostOption('Preview')

    const image = await screen.findByAltText(':blobcat:')
    expect(image).toHaveAttribute(
      'src',
      'https://activities.local/emojis/blobcat.png'
    )
    expect(screen.getAllByText('hidden secret')).toHaveLength(2)
  })

  it('shows nothing to preview message when textarea is empty', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    await choosePostOption('Preview')

    expect(screen.getByText('Nothing to preview')).toBeInTheDocument()
  })
})

describe('PostBox character counter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createNoteMock.mockResolvedValue({ status: editStatus, attachments: [] })
  })

  const renderPostBox = (maxStatusCharacters?: number) =>
    render(
      <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

  it.each([
    {
      description:
        'counts down from the default limit when no limit is provided',
      maxStatusCharacters: undefined,
      text: 'hello',
      expectedRemaining: '495',
      expectedOverLimit: false
    },
    {
      description: 'counts down from the instance-configured limit',
      maxStatusCharacters: 1000,
      text: 'hello',
      expectedRemaining: '995',
      expectedOverLimit: false
    },
    {
      description:
        'stays within budget past 500 characters when the limit is raised',
      maxStatusCharacters: 1000,
      text: 'a'.repeat(700),
      expectedRemaining: '300',
      expectedOverLimit: false
    },
    {
      description: 'goes negative past a lowered instance limit',
      maxStatusCharacters: 100,
      text: 'a'.repeat(120),
      expectedRemaining: '-20',
      expectedOverLimit: true
    }
  ])(
    '$description',
    ({ maxStatusCharacters, text, expectedRemaining, expectedOverLimit }) => {
      renderPostBox(maxStatusCharacters)

      fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
        target: { value: text }
      })

      const counter = screen.getByText(expectedRemaining)
      expect(counter).toBeInTheDocument()
      // The counter turns destructive only past the resolved limit — with a
      // hardcoded 500 both the raised and the lowered case would be wrong.
      if (expectedOverLimit) expect(counter).toHaveClass('text-destructive')
      else expect(counter).toHaveClass('text-muted-foreground')
    }
  )

  it('allows posting past 500 characters when the instance limit is higher', async () => {
    renderPostBox(1000)

    const message = 'a'.repeat(700)
    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: message }
    })

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeEnabled()

    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({ message })
    )
  })

  it('blocks posting past a lowered instance limit', () => {
    renderPostBox(100)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('re-enables the submit button when the instance limit is raised under an open draft', () => {
    const { rerender } = renderPostBox(100)

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    // The layout re-renders with a new resolved limit (router.refresh()); the
    // draft itself does not change, so nothing re-runs the handlers.
    rerender(
      <InstanceLimitsProvider maxStatusCharacters={1000}>
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })
})

describe('PostBox poll creation', () => {
  // The poll editor renders a Radix Switch, which measures itself; jsdom has no
  // ResizeObserver.
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id' as never)
    createPollMock.mockResolvedValue(undefined)
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('clears the draft after creating a poll so it cannot be re-posted as a note', async () => {
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    await choosePostOption('Poll')
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPollMock).toHaveBeenCalled())

    // The poll UI is gone; if the question text survived, the re-enabled Post
    // button would create a duplicate plain note on the next click.
    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('reuses the idempotencyKey when a failed poll is retried and mints a fresh key for the next poll', async () => {
    createPollMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(undefined)
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    await choosePostOption('Poll')
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)

    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(1))
    const firstKey = createPollMock.mock.calls[0]?.[0]?.idempotencyKey
    expect(isPublicId(firstKey!)).toBe(true)

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(2))
    expect(createPollMock.mock.calls[1]?.[0]?.idempotencyKey).toBe(firstKey)

    await waitFor(() => expect(textarea).toHaveValue(''))
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    await choosePostOption('Poll')
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(3))
    const nextKey = createPollMock.mock.calls[2]?.[0]?.idempotencyKey
    expect(isPublicId(nextKey!)).toBe(true)
    expect(nextKey).not.toBe(firstKey)
  })
  it('mints a fresh idempotencyKey when a failed poll is edited before the retry', async () => {
    createPollMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue(undefined)
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    await choosePostOption('Poll')
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(1))
    const firstKey = createPollMock.mock.calls[0]?.[0]?.idempotencyKey

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.change(textarea, { target: { value: 'Best editor?' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(2))
    const editedKey = createPollMock.mock.calls[1]?.[0]?.idempotencyKey
    expect(isPublicId(editedKey!)).toBe(true)
    expect(editedKey).not.toBe(firstKey)
  })

  it('locks a poll draft after a 503 and retries the same poll under the same key', async () => {
    createPollMock
      .mockRejectedValueOnce(new ApiRequestError('kept', 503))
      .mockResolvedValue(undefined)
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'Best framework?' } })
    await choosePostOption('Poll')
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(1))

    await waitFor(() => expect(postButton).toBeEnabled())
    expect(textarea).toHaveAttribute('readonly')
    expect(screen.getByPlaceholderText('Choice 1')).toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: 'Add choice' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove poll' })).toBeDisabled()
    expect(screen.getByRole('switch')).toBeDisabled()

    fireEvent.click(postButton)
    await waitFor(() => expect(createPollMock).toHaveBeenCalledTimes(2))
    const [first, retry] = createPollMock.mock.calls.map(([call]) => call)
    expect(retry).toEqual(first)

    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(textarea).not.toHaveAttribute('readonly')
    expect(screen.queryByText(/Editing is locked/)).not.toBeInTheDocument()
  })
})

describe('PostBox new post character limit with attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:new-media')
    global.URL.revokeObjectURL = vi.fn()
    global.crypto.randomUUID = vi.fn(() => 'temporary-media-id' as never)
  })

  it('keeps an over-limit new post unsubmittable when media is attached', async () => {
    render(
      <InstanceLimitsProvider maxStatusCharacters={100}>
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'a'.repeat(120) }
    })

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: {
        files: [new File(['image'], 'image.png', { type: 'image/png' })]
      }
    })

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Remove media image.png' })
      ).toBeInTheDocument()
    )
    // hasNewPostContent runs from the attachment call site here — a hardcoded
    // 500 would wrongly re-enable Post for this 120-character draft.
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })
})

describe('PostBox attachment ref guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.URL.createObjectURL = vi.fn(() => 'blob:test-media')
    global.URL.revokeObjectURL = vi.fn()
    let counter = 0
    global.crypto.randomUUID = vi.fn(() => `temp-media-${counter++}` as never)
    uploadAttachmentMock.mockImplementation((file) =>
      Promise.resolve({
        type: 'upload',
        id: `uploaded-${file.name}`,
        mediaType: file.type,
        url: `https://activities.local/api/v1/files/${file.name}`,
        width: 640,
        height: 480,
        name: file.name
      })
    )
    createNoteMock.mockResolvedValue({ status: editStatus, attachments: [] })
  })

  afterEach(() => {
    resizeImageMock.mockImplementation((file: File) => Promise.resolve(file))
  })

  // postExtensionRef is written synchronously in onAddAttachment before the
  // capped dispatch fires, so the upload that starts on attach
  // reads it directly rather than the reducer-committed postExtension.
  //
  // Two picker batches fired back to back — before either's resizeImage
  // settles — both read the same stale, still-below-cap attachment count and
  // each decide to proceed. Batch A is let through to fully commit (and its
  // [postExtension] resync effect runs, so ref and postExtension agree at the
  // cap) before batch B is let through: B's dispatch is then a genuinely
  // separate update the reducer's own cap correctly rejects, leaving
  // postExtension untouched — so no further resync effect ever runs to
  // notice that B's *ref* write (done unconditionally, before its dispatch)
  // pushed postExtensionRef.current one past the cap. Only the ref guard
  // itself stops that write.
  it('keeps the submitted attachments at the configured cap across two overlapping picker batches', async () => {
    const fileA = new File(['a'], 'a.png', { type: 'image/png' })
    const fileB = new File(['b'], 'b.png', { type: 'image/png' })
    // Each file's resizeImage step settles on its own schedule, rather than
    // via the file-name-based Promise.resolve() every other describe block in
    // this file installs.
    const resizeA = createDeferred<File>()
    const resizeB = createDeferred<File>()
    resizeImageMock.mockImplementation((file: File) => {
      if (file.name === fileA.name) return resizeA.promise
      if (file.name === fileB.name) return resizeB.promise
      return Promise.resolve(file)
    })

    render(
      <InstanceLimitsProvider maxMediaAttachments={1}>
        <PostBox
          host="activities.local"
          profile={profile}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )

    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!

    // Neither has resolved yet, so both compute their available-slot check
    // off the same, still-empty attachment list.
    fireEvent.change(fileInput, { target: { files: [fileA] } })
    fireEvent.change(fileInput, { target: { files: [fileB] } })

    // Let batch A finish and commit on its own — including the
    // [postExtension] resync effect — before batch B is allowed to run.
    await act(async () => {
      resizeA.resolve(fileA)
      await new Promise((r) => setTimeout(r, 0))
    })

    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeEnabled()

    // Now batch B resolves against an already-settled postExtension: its
    // dispatch is a genuinely separate update the reducer rejects outright.
    await act(async () => {
      resizeB.resolve(fileB)
      await new Promise((r) => setTimeout(r, 0))
    })

    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalled())

    expect(uploadAttachmentMock).toHaveBeenCalledTimes(1)
    expect(createNoteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [expect.objectContaining({ name: 'a.png' })]
      })
    )
  })
})

describe('PostBox automatic vertical growth', () => {
  it('updates measured height on content change when native field-sizing is not supported', async () => {
    const originalCSS = globalThis.CSS
    globalThis.CSS = {
      supports: vi.fn(() => false)
    } as unknown as typeof CSS

    try {
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
      })
      const textarea = screen.getByPlaceholderText(
        'What is on your mind?'
      ) as HTMLTextAreaElement

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 160
      })

      act(() => {
        fireEvent.change(textarea, {
          target: { value: 'Line 1\nLine 2\nLine 3' }
        })
      })

      expect(textarea.style.height).toBe('160px')

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 72
      })

      act(() => {
        fireEvent.change(textarea, { target: { value: '' } })
      })

      expect(textarea.style.height).toBe('72px')
    } finally {
      globalThis.CSS = originalCSS
    }
  })
})

const flushMicrotasks = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('PostBox idempotency key', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)
  })

  it('reuses the UUIDv7 idempotencyKey across retries of the same submit series and mints a fresh key on the next post', async () => {
    createNoteMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ status: editStatus, attachments: [] })

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })

    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const firstKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
    expect(firstKey).toBeDefined()
    expect(isPublicId(firstKey!)).toBe(true)

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    const retryKey = createNoteMock.mock.calls[1]?.[0]?.idempotencyKey
    expect(retryKey).toBe(firstKey)

    await waitFor(() => expect(textarea).toHaveValue(''))
    fireEvent.change(textarea, { target: { value: 'First post' } })
    fireEvent.click(postButton)

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
    const secondPostKey = createNoteMock.mock.calls[2]?.[0]?.idempotencyKey
    expect(secondPostKey).toBeDefined()
    expect(isPublicId(secondPostKey!)).toBe(true)
    expect(secondPostKey).not.toBe(firstKey)
  })

  it('mints a fresh idempotencyKey when a failed post is edited before the retry', async () => {
    createNoteMock
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValue({ status: editStatus, attachments: [] })
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    const firstKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.change(textarea, { target: { value: 'First post, edited' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    const editedKey = createNoteMock.mock.calls[1]?.[0]?.idempotencyKey
    expect(isPublicId(editedKey!)).toBe(true)
    expect(editedKey).not.toBe(firstKey)
  })

  it.each([503, 409])(
    'locks a note draft after a %i and retries the same payload under the same key',
    async (status) => {
      createNoteMock
        .mockRejectedValueOnce(new ApiRequestError('kept', status))
        .mockResolvedValue({ status: editStatus, attachments: [] })
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )

      const textarea = screen.getByPlaceholderText('What is on your mind?')
      fireEvent.change(textarea, { target: { value: 'First post' } })
      const postButton = screen.getByRole('button', { name: 'Post' })
      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

      await waitFor(() => expect(postButton).toBeEnabled())
      expect(textarea).toHaveAttribute('readonly')
      expect(screen.getByRole('status')).toHaveTextContent(/Editing is locked/)
      await expectPostOptionsLocked()

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      const [first, retry] = createNoteMock.mock.calls.map(([call]) => call)
      expect(retry).toEqual(first)

      await waitFor(() => expect(textarea).toHaveValue(''))
      expect(textarea).not.toHaveAttribute('readonly')
      expect(screen.queryByText(/Editing is locked/)).not.toBeInTheDocument()
      await expectPostOptionsLocked(false)
    }
  )

  const renderComposer = () =>
    render(
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

  const lockDraft = async () => {
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const view = renderComposer()
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    await waitFor(() => expect(postButton).toBeEnabled())
    return { ...view, textarea, postButton }
  }

  it('keeps Post enabled for a locked draft when the instance limit drops below its length', async () => {
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const composer = (maxStatusCharacters: number) => (
      <InstanceLimitsProvider maxStatusCharacters={maxStatusCharacters}>
        <PostBox
          host="activities.local"
          profile={profile}
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      </InstanceLimitsProvider>
    )
    const { rerender } = render(composer(500))
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const postButton = screen.getByRole('button', { name: 'Post' })
    fireEvent.click(postButton)
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    await waitFor(() => expect(postButton).toBeEnabled())
    const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    // An admin lowers the limit below the saved draft's length.
    rerender(composer(5))
    expect(postButton).toBeEnabled()
    // The locked draft cannot be edited down, so the counter stays muted.
    expect(screen.getByText('-5')).not.toHaveClass('text-destructive')

    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    expect(createNoteMock.mock.calls[1]?.[0]?.idempotencyKey).toBe(lockedKey)
  })

  it('unlocks a locked draft and mints a new key only when the retry gets a 410', async () => {
    {
      const { textarea, postButton } = await lockDraft()
      const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
      createNoteMock.mockRejectedValueOnce(new ApiRequestError('gone', 410))

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(textarea).not.toHaveAttribute('readonly'))
      expect(screen.queryByText(/Editing is locked/)).not.toBeInTheDocument()
      await waitFor(() => expect(postButton).toBeEnabled())

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      const nextKey = createNoteMock.mock.calls[2]?.[0]?.idempotencyKey
      expect(isPublicId(nextKey!)).toBe(true)
      expect(nextKey).not.toBe(lockedKey)
    }
  })

  it.each([401, 403])(
    'keeps a locked draft and its key and asks to sign in again when the retry gets a %i',
    async (status) => {
      const { textarea, postButton } = await lockDraft()
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
      // A lock says it on its own status line, with no Alert.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(window.alert).not.toHaveBeenCalled()
      expect(textarea).toHaveAttribute('readonly')

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      expect(createNoteMock.mock.calls[2]?.[0]?.idempotencyKey).toBe(lockedKey)
    }
  )

  it.each([422, 400, 404, 500, 401, 403])(
    'does not lock the draft for a first failure of %i',
    async (status) => {
      createNoteMock.mockRejectedValueOnce(new ApiRequestError('no', status))
      renderComposer()
      const textarea = screen.getByPlaceholderText('What is on your mind?')
      fireEvent.change(textarea, { target: { value: 'First post' } })
      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("Couldn't send.")
      expect(alert).toHaveTextContent('no')
      expect(window.alert).not.toHaveBeenCalled()
      expect(textarea).not.toHaveAttribute('readonly')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    }
  )

  it('locks every control of a kept draft and unlocks them on a re-target', async () => {
    const target = (id: string) =>
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
        text: 'target',
        tags: [],
        to: [],
        cc: []
      }) as unknown as Status
    const composer = (replyId: string) => (
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        replyStatus={target(replyId)}
        quotedStatus={target('quoted')}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const { rerender } = render(composer('one'))
    await choosePostOption('Content warning')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    const textarea = document.querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'First post' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))

    expect(screen.getByRole('status')).toHaveTextContent(/Editing is locked/)
    expect(
      screen.getByRole('textbox', { name: 'Content warning' })
    ).toHaveAttribute('readonly')
    for (const name of [
      'Dismiss reply',
      'Dismiss quote',
      /Add media/,
      'Add emoji or sticker'
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }

    rerender(composer('two'))

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(document.querySelector('textarea')).not.toHaveAttribute('readonly')
    for (const name of [
      'Dismiss reply',
      'Dismiss quote',
      /Add media/,
      'Add emoji or sticker'
    ]) {
      expect(screen.getByRole('button', { name })).toBeEnabled()
    }
  })

  it.each([
    ['a network error', () => new Error('offline')],
    ['a 500', () => new ApiRequestError('boom', 500)],
    ['a 429', () => new ApiRequestError('slow down', 429)],
    ['a 400', () => new ApiRequestError('Bad Request', 400)],
    ['a 422', () => new ApiRequestError('Text too long', 422)],
    ['a 404', () => new ApiRequestError('Record not found', 404)]
  ])(
    'keeps a locked draft and its key and shows the message when the retry fails with %s',
    async (_name, makeError) => {
      const { textarea, postButton } = await lockDraft()
      const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey
      const error = makeError()
      createNoteMock.mockRejectedValueOnce(error)
      const lockedMessage = `Couldn't send your saved post (${error.message}). Press Post to retry or discard the draft.`

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(postButton).toBeEnabled())
      expect(textarea).toHaveAttribute('readonly')
      expect(screen.getByRole('status')).toHaveTextContent(
        `${lockedMessage} ${DRAFT_LOCKED_NOTICE}`
      )
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(window.alert).not.toHaveBeenCalled()

      fireEvent.click(postButton)
      await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(3))
      expect(createNoteMock.mock.calls[2]?.[0]?.idempotencyKey).toBe(lockedKey)
    }
  )

  it('does not lock the new draft when a kept failure lands after a re-target', async () => {
    const pending = createDeferred<never>()
    createNoteMock.mockReturnValueOnce(pending.promise)
    const { rerender } = renderComposer()
    fireEvent.change(screen.getByPlaceholderText('What is on your mind?'), {
      target: { value: 'First post' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    rerender(
      <PostBox
        host="activities.local"
        profile={profile}
        isMediaUploadEnabled
        replyStatus={
          {
            id: 'https://activities.local/users/llun/statuses/1',
            type: 'Note',
            actorId: profile.id,
            actor: null,
            text: 'hi',
            to: [],
            cc: [],
            attachments: [],
            tags: []
          } as never
        }
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    await act(async () => {
      pending.reject(new ApiRequestError('kept', 503))
      await pending.promise.catch(() => undefined)
    })

    // The failure belongs to the old draft: the new one hears nothing.
    expect(window.alert).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/Editing is locked/)).not.toBeInTheDocument()
    expect(document.querySelector('textarea')).not.toHaveAttribute('readonly')
  })

  it('discards a locked draft and its key without deleting the kept media', async () => {
    resetEditMediaMocks()
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    const { unmount } = renderComposer()
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    fireEvent.change(fileInput, {
      target: { files: [new File(['kept'], 'kept.png', { type: 'image/png' })] }
    })
    const postButton = screen.getByRole('button', { name: 'Post' })
    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    expect(createNoteMock.mock.calls[0]?.[0]?.attachments).toHaveLength(1)
    const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))

    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(textarea).not.toHaveAttribute('readonly')
    expect(screen.queryByText(/Editing is locked/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Remove media/ })
    ).not.toBeInTheDocument()

    createNoteMock.mockResolvedValueOnce({
      status: editStatus,
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'Next post' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    expect(createNoteMock.mock.calls[1]?.[0]?.idempotencyKey).not.toBe(
      lockedKey
    )
    unmount()
    expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
  })

  it('mints a new key when the same text is retyped after Discard draft', async () => {
    const { textarea, postButton } = await lockDraft()
    const lockedKey = createNoteMock.mock.calls[0]?.[0]?.idempotencyKey

    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(textarea).toHaveValue(''))

    createNoteMock.mockResolvedValueOnce({
      status: editStatus,
      attachments: []
    })
    fireEvent.change(textarea, { target: { value: 'First post' } })
    fireEvent.click(postButton)
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(2))
    expect(createNoteMock.mock.calls[1]?.[0]?.idempotencyKey).not.toBe(
      lockedKey
    )
  })

  it('drops a media batch that settles in the same tick the draft locks', async () => {
    const resized = createDeferred<File>()
    resizeImageMock.mockReturnValueOnce(resized.promise)
    const pending = createDeferred<never>()
    createNoteMock.mockReturnValueOnce(pending.promise)
    renderComposer()
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    const file = new File(['late'], 'late.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))

    // Both settle before React renders the lock.
    await act(async () => {
      pending.reject(new ApiRequestError('kept', 503))
      await pending.promise.catch(() => undefined)
      await flushMicrotasks()
      resized.resolve(file)
      await resized.promise
      await flushMicrotasks()
    })

    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))
    expect(
      screen.queryByRole('button', { name: 'Remove media late.png' })
    ).not.toBeInTheDocument()
  })

  it('drops a media batch that lands after the draft locked', async () => {
    const resized = createDeferred<File>()
    resizeImageMock.mockReturnValueOnce(resized.promise)
    createNoteMock.mockRejectedValueOnce(new ApiRequestError('kept', 503))
    renderComposer()
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'First post' } })
    const fileInput = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="file"][name="file"]'
      )
    ).at(-1)!
    const file = new File(['late'], 'late.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(textarea).toHaveAttribute('readonly'))

    await act(async () => {
      resized.resolve(file)
      await resized.promise
    })

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledTimes(1))
    expect(
      screen.queryByRole('button', { name: 'Remove media late.png' })
    ).not.toBeInTheDocument()
    expect(uploadAttachmentMock).not.toHaveBeenCalled()
  })
})
