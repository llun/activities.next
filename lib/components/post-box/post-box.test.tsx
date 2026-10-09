/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getCustomEmojis } from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { createDeferred } from '@/lib/testing/deferred'
import { Status, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'
import {
  createNoteMock,
  createPollMock,
  editStatus,
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
    fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Add content warning' }))
    const cwInput = screen.getByPlaceholderText('Write your warning here')
    fireEvent.change(cwInput, { target: { value: 'CW :blobcat:' } })
    const textarea = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textarea, { target: { value: 'hidden secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Toggle preview' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Add poll' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(createPollMock).toHaveBeenCalled())

    // The poll UI is gone; if the question text survived, the re-enabled Post
    // button would create a duplicate plain note on the next click.
    await waitFor(() => expect(textarea).toHaveValue(''))
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
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
