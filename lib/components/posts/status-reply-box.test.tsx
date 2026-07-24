/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { createNote } from '@/lib/client'
import { InstanceLimitsProvider } from '@/lib/components/instance-limits'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { StatusReplyBox } from './status-reply-box'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  uploadAttachment: vi.fn()
}))

const createNoteMock = createNote as jest.MockedFunction<typeof createNote>

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
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: []
}

describe('StatusReplyBox', () => {
  beforeEach(() => {
    createNoteMock.mockResolvedValue({
      status: replyStatus,
      attachments: []
    })
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
