/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { repostStatus, undoRepostStatus } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

import { RepostButton } from './repost-button'

vi.mock('@/lib/client', () => ({
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const actor: ActorProfile = {
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

const currentActor: ActorProfile = {
  ...actor,
  id: 'https://activities.local/users/other',
  username: 'other'
}

const status: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: actor.id,
  actor,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Post content',
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

const boostId = 'https://activities.local/users/other/statuses/boost-1'

describe('RepostButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing for a signed-out viewer', () => {
    const { container } = render(<RepostButton status={status} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('reposts the status and then offers to undo it', async () => {
    ;(repostStatus as jest.Mock).mockResolvedValue({ statusId: boostId })
    render(<RepostButton currentActor={currentActor} status={status} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repost' }))
    })

    expect(repostStatus).toHaveBeenCalledWith({ statusId: status.id })
    expect(
      screen.getByRole('button', { name: 'Undo repost' })
    ).toBeInTheDocument()
  })

  it('stays on Repost when the repost request returns nothing', async () => {
    ;(repostStatus as jest.Mock).mockResolvedValue(null)
    render(<RepostButton currentActor={currentActor} status={status} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repost' }))
    })

    expect(screen.getByRole('button', { name: 'Repost' })).toBeEnabled()
  })

  it('undoes an existing repost using the boost status id', async () => {
    ;(undoRepostStatus as jest.Mock).mockResolvedValue(true)
    render(
      <RepostButton
        currentActor={currentActor}
        status={{ ...status, actorAnnounceStatusId: boostId }}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo repost' }))
    })

    expect(undoRepostStatus).toHaveBeenCalledWith({ statusId: boostId })
    expect(repostStatus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Repost' })).toBeInTheDocument()
  })

  it('keeps Undo repost when undoing fails', async () => {
    ;(undoRepostStatus as jest.Mock).mockResolvedValue(false)
    render(
      <RepostButton
        currentActor={currentActor}
        status={{ ...status, actorAnnounceStatusId: boostId }}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo repost' }))
    })

    expect(screen.getByRole('button', { name: 'Undo repost' })).toBeEnabled()
  })

  it('reads repost state from the original post when given a boost', async () => {
    const boost: Status = {
      ...status,
      id: 'https://activities.local/users/booster/statuses/boost-9',
      type: StatusType.enum.Announce,
      originalStatus: { ...status, actorAnnounceStatusId: boostId }
    }
    ;(undoRepostStatus as jest.Mock).mockResolvedValue(true)
    render(<RepostButton currentActor={currentActor} status={boost} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Undo repost' }))
    })

    expect(undoRepostStatus).toHaveBeenCalledWith({ statusId: boostId })
  })

  it('disables the button while the request is in flight', async () => {
    const deferred = createDeferred<{ statusId: string } | null>()
    ;(repostStatus as jest.Mock).mockReturnValue(deferred.promise)
    render(<RepostButton currentActor={currentActor} status={status} />)

    fireEvent.click(screen.getByRole('button', { name: 'Repost' }))
    expect(screen.getByRole('button', { name: 'Repost' })).toBeDisabled()

    await act(async () => {
      deferred.resolve({ statusId: boostId })
    })
    expect(screen.getByRole('button', { name: 'Undo repost' })).toBeEnabled()
  })

  it('follows the status when the server-side repost id changes', () => {
    const { rerender } = render(
      <RepostButton currentActor={currentActor} status={status} />
    )
    expect(screen.getByRole('button', { name: 'Repost' })).toBeInTheDocument()

    rerender(
      <RepostButton
        currentActor={currentActor}
        status={{ ...status, actorAnnounceStatusId: boostId }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Undo repost' })
    ).toBeInTheDocument()
  })

  it('does not bubble clicks to a parent handler', async () => {
    ;(repostStatus as jest.Mock).mockResolvedValue({ statusId: boostId })
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <RepostButton currentActor={currentActor} status={status} />
      </div>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repost' }))
    })

    expect(onParentClick).not.toHaveBeenCalled()
  })
})
