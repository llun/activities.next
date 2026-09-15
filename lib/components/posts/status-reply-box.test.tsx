/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createNote, uploadAttachment } from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
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
  it('configures native sizing classes on the reply textarea', () => {
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
    )
    expect(textarea).toHaveClass('field-sizing-content')
    expect(textarea).toHaveClass('min-h-[60px]')
    expect(textarea).toHaveClass('max-h-[min(320px,40dvh)]')
    expect(textarea).toHaveClass('overflow-y-auto')
  })

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
