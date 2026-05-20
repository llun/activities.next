/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { deleteStatus } from '@/lib/client'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { DeleteButton } from './delete-button'

jest.mock('@/lib/client', () => ({
  deleteStatus: jest.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const status: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
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
  },
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

describe('DeleteButton', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('disables while deleting to avoid duplicate requests', async () => {
    let resolveDelete: (value: boolean) => void = () => {}
    const deletePromise = new Promise<boolean>((resolve) => {
      resolveDelete = resolve
    })
    ;(deleteStatus as jest.Mock).mockReturnValue(deletePromise)
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true)
    const onPostDeleted = jest.fn()

    render(<DeleteButton status={status} onPostDeleted={onPostDeleted} />)

    const button = screen.getByRole('button', { name: 'Delete post' })
    fireEvent.click(button)

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(deleteStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveDelete(true)
      await deletePromise
    })

    expect(button).toBeEnabled()
    expect(onPostDeleted).toHaveBeenCalledWith(status)
  })

  it('shows an error and keeps the post when delete fails', async () => {
    ;(deleteStatus as jest.Mock).mockResolvedValue(false)
    jest.spyOn(window, 'confirm').mockReturnValue(true)
    const onPostDeleted = jest.fn()

    render(<DeleteButton status={status} onPostDeleted={onPostDeleted} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete post' }))

    expect(
      await screen.findByText('Failed to delete post. Please try again.')
    ).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('button', { name: 'Delete post' })).toBeEnabled()
    expect(onPostDeleted).not.toHaveBeenCalled()
  })
})
