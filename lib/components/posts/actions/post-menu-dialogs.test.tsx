/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { block, createReport, deleteStatus, mute } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import {
  BlockDialog,
  DeleteDialog,
  MuteDialog,
  ReportDialog
} from './post-menu-dialogs'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh })
}))

vi.mock('@/lib/client', () => ({
  block: vi.fn(),
  createReport: vi.fn(),
  deleteStatus: vi.fn(),
  mute: vi.fn()
}))

const targetActorId = 'https://remote.example/users/maythee'

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: targetActorId,
  following: false,
  showing_reblogs: false,
  notifying: false,
  languages: null,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  muting_expires_at: null,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  note: '',
  ...overrides
})

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()
const owner: ActorProfile = {
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
const ownStatus: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: owner.id,
  actor: owner,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'My own post',
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

describe('MuteDialog', () => {
  const renderDialog = (open = true) => {
    const onOpenChange = vi.fn()
    const onMuted = vi.fn()
    const view = render(
      <MuteDialog
        open={open}
        onOpenChange={onOpenChange}
        actorName="Maythee"
        targetActorId={targetActorId}
        onMuted={onMuted}
      />
    )
    return { onOpenChange, onMuted, ...view }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('mutes with notifications hidden by default, then closes and refreshes', async () => {
    const muted = relationship({ muting: true, muting_notifications: true })
    ;(mute as jest.Mock).mockResolvedValue(muted)
    const { onOpenChange, onMuted } = renderDialog()

    expect(screen.getByText('Mute Maythee?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    })

    expect(mute).toHaveBeenCalledWith({ targetActorId, notifications: true })
    expect(onMuted).toHaveBeenCalledWith(muted)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps notifications visible when the hide-notifications box is unticked', async () => {
    ;(mute as jest.Mock).mockResolvedValue(relationship({ muting: true }))
    renderDialog()

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Also hide notifications from this account'
      })
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    })

    expect(mute).toHaveBeenCalledWith({ targetActorId, notifications: false })
  })

  it.each([
    ['the request returns nothing', () => Promise.resolve(null)],
    [
      'the server does not report the account as muted',
      () => Promise.resolve(relationship({ muting: false }))
    ],
    ['the request throws', () => Promise.reject(new Error('network down'))]
  ])('shows an error and stays open when %s', async (_name, impl) => {
    ;(mute as jest.Mock).mockImplementation(impl)
    const { onOpenChange, onMuted } = renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to mute account. Please try again.'
    )
    expect(onMuted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mute' })).toBeEnabled()
  })

  it('disables both buttons while the mute is in flight', async () => {
    const deferred = createDeferred<MastodonRelationship | null>()
    ;(mute as jest.Mock).mockReturnValue(deferred.promise)
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))

    expect(screen.getByRole('button', { name: 'Mute' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await act(async () => {
      deferred.resolve(null)
    })
  })

  it('closes without muting when cancelled', () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mute).not.toHaveBeenCalled()
  })

  it('clears a previous error when reopened', async () => {
    ;(mute as jest.Mock).mockResolvedValue(null)
    const { rerender, onOpenChange, onMuted } = renderDialog()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()

    const props = {
      actorName: 'Maythee',
      targetActorId,
      onOpenChange,
      onMuted
    }
    rerender(<MuteDialog {...props} open={false} />)
    rerender(<MuteDialog {...props} open />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('BlockDialog', () => {
  const renderDialog = () => {
    const onOpenChange = vi.fn()
    const onBlocked = vi.fn()
    render(
      <BlockDialog
        open
        onOpenChange={onOpenChange}
        actorName="Maythee"
        targetActorId={targetActorId}
        onBlocked={onBlocked}
      />
    )
    return { onOpenChange, onBlocked }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('blocks the account, then closes and refreshes', async () => {
    const blocked = relationship({ blocking: true })
    ;(block as jest.Mock).mockResolvedValue(blocked)
    const { onOpenChange, onBlocked } = renderDialog()

    expect(screen.getByText('Block Maythee?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    })

    expect(block).toHaveBeenCalledWith({ targetActorId })
    expect(onBlocked).toHaveBeenCalledWith(blocked)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the request returns nothing', () => Promise.resolve(null)],
    [
      'the server does not report the account as blocked',
      () => Promise.resolve(relationship({ blocking: false }))
    ],
    ['the request throws', () => Promise.reject(new Error('network down'))]
  ])('shows an error and stays open when %s', async (_name, impl) => {
    ;(block as jest.Mock).mockImplementation(impl)
    const { onOpenChange, onBlocked } = renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Block' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to block account. Please try again.'
    )
    expect(onBlocked).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('closes without blocking when cancelled', () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(block).not.toHaveBeenCalled()
  })
})

describe('ReportDialog', () => {
  const renderDialog = () => {
    const onOpenChange = vi.fn()
    render(
      <ReportDialog
        open
        onOpenChange={onOpenChange}
        targetActorId={targetActorId}
        statusId="https://remote.example/users/maythee/statuses/post-9"
      />
    )
    return { onOpenChange }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports with the picked category and a trimmed comment, then closes', async () => {
    ;(createReport as jest.Mock).mockResolvedValue(true)
    const { onOpenChange } = renderDialog()

    fireEvent.click(
      screen.getByRole('radio', { name: 'It violates server rules' })
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional comments' }),
      { target: { value: '  harassing me  ' } }
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    })

    expect(createReport).toHaveBeenCalledWith({
      targetActorId,
      statusId: 'https://remote.example/users/maythee/statuses/post-9',
      category: 'violation',
      comment: 'harassing me'
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('omits the comment when it is only whitespace', async () => {
    ;(createReport as jest.Mock).mockResolvedValue(true)
    renderDialog()

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Additional comments' }),
      { target: { value: '   ' } }
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    })

    expect(createReport).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'spam', comment: undefined })
    )
  })

  it.each([
    ['the server rejects the report', () => Promise.resolve(false)],
    ['the request throws', () => Promise.reject(new Error('network down'))]
  ])('shows an error and stays open when %s', async (_name, impl) => {
    ;(createReport as jest.Mock).mockImplementation(impl)
    const { onOpenChange } = renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to submit report. Please try again.'
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes without reporting when cancelled', () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(createReport).not.toHaveBeenCalled()
  })
})

describe('DeleteDialog', () => {
  const renderDialog = (onPostDeleted?: (status: Status) => void) => {
    const onOpenChange = vi.fn()
    render(
      <DeleteDialog
        open
        onOpenChange={onOpenChange}
        status={ownStatus}
        onPostDeleted={onPostDeleted}
      />
    )
    return { onOpenChange }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the status, closes, and tells the caller', async () => {
    ;(deleteStatus as jest.Mock).mockResolvedValue(true)
    const onPostDeleted = vi.fn()
    const { onOpenChange } = renderDialog(onPostDeleted)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(deleteStatus).toHaveBeenCalledWith({ statusId: ownStatus.id })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onPostDeleted).toHaveBeenCalledWith(ownStatus)
  })

  it('deletes without a caller callback', async () => {
    ;(deleteStatus as jest.Mock).mockResolvedValue(true)
    const { onOpenChange } = renderDialog()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each([
    ['the server refuses', () => Promise.resolve(false)],
    ['the request throws', () => Promise.reject(new Error('network down'))]
  ])('shows an error and keeps the post when %s', async (_name, impl) => {
    ;(deleteStatus as jest.Mock).mockImplementation(impl)
    const onPostDeleted = vi.fn()
    const { onOpenChange } = renderDialog(onPostDeleted)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Failed to delete post. Please try again.'
    )
    expect(onPostDeleted).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('disables the buttons while the delete is in flight', async () => {
    const deferred = createDeferred<boolean>()
    ;(deleteStatus as jest.Mock).mockReturnValue(deferred.promise)
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await act(async () => {
      deferred.resolve(false)
    })
  })
})

describe('dismissing a dialog with Escape', () => {
  const onOpenChange = vi.fn()
  const dialogs = [
    {
      name: 'MuteDialog',
      submit: 'Mute',
      pending: () => (mute as jest.Mock).mockReturnValue(new Promise(() => {})),
      element: (
        <MuteDialog
          open
          onOpenChange={onOpenChange}
          actorName="Maythee"
          targetActorId={targetActorId}
          onMuted={vi.fn()}
        />
      )
    },
    {
      name: 'BlockDialog',
      submit: 'Block',
      pending: () =>
        (block as jest.Mock).mockReturnValue(new Promise(() => {})),
      element: (
        <BlockDialog
          open
          onOpenChange={onOpenChange}
          actorName="Maythee"
          targetActorId={targetActorId}
          onBlocked={vi.fn()}
        />
      )
    },
    {
      name: 'ReportDialog',
      submit: 'Submit report',
      pending: () =>
        (createReport as jest.Mock).mockReturnValue(new Promise(() => {})),
      element: (
        <ReportDialog
          open
          onOpenChange={onOpenChange}
          targetActorId={targetActorId}
          statusId={ownStatus.id}
        />
      )
    },
    {
      name: 'DeleteDialog',
      submit: 'Delete',
      pending: () =>
        (deleteStatus as jest.Mock).mockReturnValue(new Promise(() => {})),
      element: (
        <DeleteDialog open onOpenChange={onOpenChange} status={ownStatus} />
      )
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(dialogs)('$name closes on Escape', ({ element }) => {
    render(element)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it.each(dialogs)(
    '$name ignores Escape while its request is in flight',
    ({ element, pending, submit }) => {
      pending()
      render(element)
      fireEvent.click(screen.getByRole('button', { name: submit }))

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(onOpenChange).not.toHaveBeenCalled()
    }
  )
})
