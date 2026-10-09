/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { updateStatusVisibility } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { VisibilityButton } from './visibility-button'

vi.mock('@/lib/client', () => ({
  updateStatusVisibility: vi.fn()
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

const publicStatus: StatusNote = {
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: actor.id,
  actor,
  to: [ACTIVITY_STREAM_PUBLIC],
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

// Radix opens its menu via pointer events jsdom can't lay out; open it from
// the keyboard instead.
const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Visibility:/ }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('VisibilityButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The to/cc -> visibility mapping itself is covered by getVisibility.test.ts;
  // this one non-public case proves the button reads both fields from the status.
  it('labels the button from the status recipients', () => {
    render(
      <VisibilityButton
        status={{ ...publicStatus, to: [], cc: [ACTIVITY_STREAM_PUBLIC] }}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Visibility: Unlisted' })
    ).toBeInTheDocument()
  })

  it('renders nothing for a boost, which has no visibility of its own', () => {
    const boost: Status = {
      ...publicStatus,
      type: StatusType.enum.Announce,
      originalStatus: publicStatus
    }
    const { container } = render(<VisibilityButton status={boost} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('persists a newly picked visibility and shows it as current', async () => {
    ;(updateStatusVisibility as jest.Mock).mockResolvedValue(true)
    render(<VisibilityButton status={publicStatus} />)

    const menu = await openMenu()
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Direct/ }))
    })

    expect(updateStatusVisibility).toHaveBeenCalledTimes(1)
    expect(updateStatusVisibility).toHaveBeenCalledWith({
      statusId: publicStatus.id,
      visibility: 'direct'
    })
    expect(
      screen.getByRole('button', { name: 'Visibility: Direct' })
    ).toBeInTheDocument()
  })

  it('reverts to the previous visibility when the update fails', async () => {
    ;(updateStatusVisibility as jest.Mock).mockResolvedValue(false)
    render(<VisibilityButton status={publicStatus} />)

    const menu = await openMenu()
    await act(async () => {
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Direct/ }))
    })

    expect(updateStatusVisibility).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('button', { name: 'Visibility: Public' })
    ).toBeInTheDocument()
  })

  it('disables the trigger and shows the new value while saving', async () => {
    const deferred = createDeferred<boolean>()
    ;(updateStatusVisibility as jest.Mock).mockReturnValue(deferred.promise)
    render(<VisibilityButton status={publicStatus} />)

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Unlisted/ }))

    const trigger = screen.getByRole('button', {
      name: 'Visibility: Unlisted'
    })
    expect(trigger).toBeDisabled()

    await act(async () => {
      deferred.resolve(true)
    })
    expect(trigger).toBeEnabled()
  })

  it('does not call the API when the current visibility is picked again', async () => {
    render(<VisibilityButton status={publicStatus} />)

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Public/ }))

    expect(updateStatusVisibility).not.toHaveBeenCalled()
  })

  it('does not bubble clicks on the trigger to a parent handler', () => {
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <VisibilityButton status={publicStatus} />
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: /^Visibility:/ }))

    expect(onParentClick).not.toHaveBeenCalled()
  })
})
