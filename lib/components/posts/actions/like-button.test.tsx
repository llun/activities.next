/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { likeStatus, undoLikeStatus } from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { LikeButton } from './like-button'

jest.mock('@/lib/client', () => ({
  likeStatus: jest.fn(),
  undoLikeStatus: jest.fn()
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

describe('LikeButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('disables while liking to avoid duplicate requests', async () => {
    let resolveLike: (value: boolean) => void = () => {}
    const likePromise = new Promise<boolean>((resolve) => {
      resolveLike = resolve
    })
    ;(likeStatus as jest.Mock).mockReturnValue(likePromise)

    render(<LikeButton currentActor={currentActor} status={status} />)

    const button = screen.getByRole('button', { name: 'Like' })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(likeStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveLike(true)
      await likePromise
    })

    expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeEnabled()
  })

  it('shows an error and keeps state when liking fails', async () => {
    ;(likeStatus as jest.Mock).mockResolvedValue(false)

    render(<LikeButton currentActor={currentActor} status={status} />)

    fireEvent.click(screen.getByRole('button', { name: 'Like' }))

    expect(
      await screen.findByText('Failed to like post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Like' })).toBeEnabled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('shows an error and keeps state when unliking rejects', async () => {
    ;(undoLikeStatus as jest.Mock).mockRejectedValue(new Error('network down'))

    render(
      <LikeButton
        currentActor={currentActor}
        status={{ ...status, isActorLiked: true, totalLikes: 1 }}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unlike, 1 like' }))

    expect(
      await screen.findByText('Failed to unlike post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Unlike, 1 like' })).toBeEnabled()
  })
})
