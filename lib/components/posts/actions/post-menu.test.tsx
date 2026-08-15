/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  createReport,
  deleteStatus,
  getRelationship,
  mute,
  unmute
} from '@/lib/client'
import { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'

import { PostMenu, type PostMenuExtraSubmenuItem } from './post-menu'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh })
}))

vi.mock('@/lib/client', () => ({
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  deleteStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  updateStatusInteractionPolicy: vi.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const ownerActor: ActorProfile = {
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
  actorId: 'https://activities.local/users/llun',
  actor: ownerActor,
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

const remoteActor: ActorProfile = {
  ...ownerActor,
  id: 'https://remote.example/users/maythee',
  username: 'maythee',
  domain: 'remote.example',
  name: 'Maythee'
}

const otherStatus: StatusNote = {
  ...ownStatus,
  id: 'https://remote.example/users/maythee/statuses/post-9',
  actorId: 'https://remote.example/users/maythee',
  actor: remoteActor,
  isLocalActor: false,
  url: 'https://remote.example/@maythee/post-9',
  text: 'Someone else post'
}

const relationship = (
  overrides: Partial<MastodonRelationship> = {}
): MastodonRelationship => ({
  id: 'https://remote.example/users/maythee',
  following: false,
  showing_reblogs: false,
  notifying: false,
  languages: null,
  followed_by: false,
  blocking: false,
  blocked_by: false,
  muting: false,
  muting_notifications: false,
  requested: false,
  requested_by: false,
  domain_blocking: false,
  endorsed: false,
  note: '',
  ...overrides
})

// Radix opens its menu via pointer events that jsdom can't lay out; drive it
// from the keyboard the way SectionNavDropdown's tests do.
const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('PostMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getRelationship as jest.Mock).mockResolvedValue(null)
  })

  it('shows authoring actions for the post owner', async () => {
    render(
      <PostMenu
        status={ownStatus}
        isOwner
        canEdit
        onEdit={vi.fn()}
        onPostDeleted={vi.fn()}
      />
    )

    const menu = await openMenu()
    expect(
      within(menu).getByRole('menuitem', { name: 'Edit post' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Change visibility' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Change who can quote' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Copy link to post' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Delete post' })
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: /Report post/ })
    ).not.toBeInTheDocument()
  })

  it('offers a Quote action when onQuote is provided and fires it', async () => {
    const onQuote = vi.fn()
    render(
      <PostMenu
        status={otherStatus}
        isOwner={false}
        canEdit={false}
        onQuote={onQuote}
      />
    )

    const menu = await openMenu()
    const quoteItem = within(menu).getByRole('menuitem', { name: 'Quote post' })
    fireEvent.click(quoteItem)
    expect(onQuote).toHaveBeenCalledWith(otherStatus)
  })

  it('omits the Quote action when onQuote is not provided', async () => {
    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)
    const menu = await openMenu()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Quote post' })
    ).not.toBeInTheDocument()
  })

  it('shows relationship actions for another actor’s post', async () => {
    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    const menu = await openMenu()
    expect(
      within(menu).getByRole('menuitem', { name: /Mention @maythee/ })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Mute Maythee' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Block Maythee' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Open original' })
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('menuitem', { name: 'Report post' })
    ).toBeInTheDocument()
    expect(
      within(menu).queryByRole('menuitem', { name: 'Delete post' })
    ).not.toBeInTheDocument()
  })

  it('reflects an existing mute relationship with an Unmute action', async () => {
    ;(getRelationship as jest.Mock).mockResolvedValue(
      relationship({ muting: true })
    )

    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    await openMenu()
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Unmute Maythee' })
      ).toBeInTheDocument()
    )
    expect(getRelationship).toHaveBeenCalledWith({
      targetActorId: otherStatus.actorId
    })
  })

  it('confirms before deleting and reports success to onPostDeleted', async () => {
    ;(deleteStatus as jest.Mock).mockResolvedValue(true)
    const onPostDeleted = vi.fn()

    render(
      <PostMenu
        status={ownStatus}
        isOwner
        canEdit
        onEdit={vi.fn()}
        onPostDeleted={onPostDeleted}
      />
    )

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete post' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete this post?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(deleteStatus).toHaveBeenCalledWith({ statusId: ownStatus.id })
    )
    await waitFor(() => expect(onPostDeleted).toHaveBeenCalledWith(ownStatus))
  })

  it('submits a report with the chosen category', async () => {
    ;(createReport as jest.Mock).mockResolvedValue(true)

    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Report post' }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit report' })
    )

    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          targetActorId: otherStatus.actorId,
          statusId: otherStatus.id,
          category: 'spam'
        })
      )
    )
  })

  it('opens a mute confirmation that calls the mute client', async () => {
    ;(mute as jest.Mock).mockResolvedValue(relationship({ muting: true }))

    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    const menu = await openMenu()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Mute Maythee' })
    )

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }))

    await waitFor(() =>
      expect(mute).toHaveBeenCalledWith(
        expect.objectContaining({ targetActorId: otherStatus.actorId })
      )
    )
  })

  it('surfaces an inline error when a direct unmute fails', async () => {
    ;(getRelationship as jest.Mock).mockResolvedValue(
      relationship({ muting: true })
    )
    ;(unmute as jest.Mock).mockResolvedValue(null)

    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    await openMenu()
    const unmuteItem = await screen.findByRole('menuitem', {
      name: 'Unmute Maythee'
    })
    fireEvent.click(unmuteItem)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to unmute account. Please try again.'
      )
    )
  })

  it('retries the relationship fetch on a later open when the first fetch fails', async () => {
    ;(getRelationship as jest.Mock).mockRejectedValueOnce(new Error('network'))

    render(<PostMenu status={otherStatus} isOwner={false} canEdit={false} />)

    const menu = await openMenu()
    await waitFor(() => expect(getRelationship).toHaveBeenCalledTimes(1))

    // Close (Escape on the open menu — the trigger is aria-hidden while the menu
    // is open), then reopen. A failed first fetch must not be cached, so it runs
    // again rather than leaving the menu stuck on the default Mute/Block state.
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    )
    ;(getRelationship as jest.Mock).mockResolvedValue(
      relationship({ muting: true })
    )
    await openMenu()

    await waitFor(() => expect(getRelationship).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Unmute Maythee' })
      ).toBeInTheDocument()
    )
  })

  // Two shapes of extra item: an action the row could not fit (bookmark,
  // react), and a submenu a surface adds for something only it knows about the
  // post — the fitness activity detail's "Change gear".
  describe('extra items', () => {
    const gearSubmenu = (
      overrides: Partial<PostMenuExtraSubmenuItem> = {}
    ): PostMenuExtraSubmenuItem => ({
      key: 'change-gear',
      icon: <span data-testid="gear-icon" />,
      label: 'Change gear',
      items: [
        {
          key: 'gear-bike',
          label: 'Moots',
          checked: true,
          trailing: '42.6 km',
          onSelect: vi.fn()
        },
        {
          key: 'gear-other-bike',
          label: 'Winter bike',
          checked: false,
          onSelect: vi.fn()
        },
        {
          key: 'no-gear',
          label: 'No gear',
          checked: false,
          muted: true,
          onSelect: vi.fn()
        }
      ],
      ...overrides
    })

    const openSubmenu = async (name: string) => {
      const menu = await openMenu()
      fireEvent.keyDown(within(menu).getByRole('menuitem', { name }), {
        key: 'ArrowRight'
      })
      return waitFor(() => {
        const menus = screen.getAllByRole('menu')
        const submenu = menus[menus.length - 1]
        expect(submenu).not.toBe(menu)
        return submenu
      })
    }

    it('renders a flat extra item above the menu’s own items', async () => {
      const onSelect = vi.fn()
      render(
        <PostMenu
          status={ownStatus}
          isOwner
          canEdit
          extraItems={[
            {
              key: 'bookmark',
              icon: <span />,
              label: 'Bookmark',
              onSelect
            }
          ]}
        />
      )

      const menu = await openMenu()
      const items = within(menu).getAllByRole('menuitem')
      expect(items[0]).toHaveTextContent('Bookmark')
      fireEvent.click(items[0])
      expect(onSelect).toHaveBeenCalled()
    })

    it('renders a submenu extra item as a submenu of choices', async () => {
      render(
        <PostMenu
          status={ownStatus}
          isOwner
          canEdit
          extraItems={[gearSubmenu()]}
        />
      )

      const submenu = await openSubmenu('Change gear')
      // Pick-one-of-N, so the rows carry radio semantics — the check mark is
      // decorative, so `aria-checked` is the only thing announcing the choice.
      expect(
        within(submenu).getByRole('menuitemradio', { name: /Moots/ })
      ).toHaveAttribute('aria-checked', 'true')
      expect(
        within(submenu).getByRole('menuitemradio', { name: /Winter bike/ })
      ).toHaveAttribute('aria-checked', 'false')
      // The trailing value rides along with the label rather than taking a
      // column, which is what tells two similar entries apart at a glance.
      expect(
        within(submenu).getByRole('menuitemradio', { name: /Moots/ })
      ).toHaveTextContent('Moots42.6 km')
    })

    it('fires the chosen row’s handler', async () => {
      const item = gearSubmenu()
      render(
        <PostMenu status={ownStatus} isOwner canEdit extraItems={[item]} />
      )

      const submenu = await openSubmenu('Change gear')
      fireEvent.click(
        within(submenu).getByRole('menuitemradio', { name: /Winter bike/ })
      )
      expect(item.items[1].onSelect).toHaveBeenCalled()
      expect(item.items[0].onSelect).not.toHaveBeenCalled()
    })

    it('leaves a disabled submenu unopenable rather than opening a dead one', async () => {
      render(
        <PostMenu
          status={ownStatus}
          isOwner
          canEdit
          extraItems={[
            gearSubmenu({
              disabled: true,
              items: gearSubmenu().items.map((subItem) => ({
                ...subItem,
                disabled: true
              }))
            })
          ]}
        />
      )

      const menu = await openMenu()
      const trigger = within(menu).getByRole('menuitem', {
        name: 'Change gear'
      })
      expect(trigger).toHaveAttribute('data-disabled')
      fireEvent.keyDown(trigger, { key: 'ArrowRight' })
      // A menu of choices none of which respond is worse than one that will
      // not open, so the trigger is disabled alongside its rows.
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      // …and it has to LOOK disabled. Radix emits `data-disabled` on the inert
      // trigger but ships no styling for it, so without these classes it paints
      // identically to the enabled "Change visibility" beside it and reads as a
      // broken control. `DropdownMenuSubTrigger` was the one item primitive
      // missing them; its three siblings have always carried them. One
      // assertion each, because `.toHaveClass(a, b)` passes when EITHER is
      // present.
      expect(trigger).toHaveClass('data-[disabled]:opacity-50')
      expect(trigger).toHaveClass('data-[disabled]:pointer-events-none')
    })

    it('keeps the menu’s own items below the extras', async () => {
      render(
        <PostMenu
          status={ownStatus}
          isOwner
          canEdit
          onEdit={vi.fn()}
          extraItems={[gearSubmenu()]}
        />
      )

      const menu = await openMenu()
      const labels = within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      // An extra item can only ADD — Edit, visibility and the rest are all
      // still there, and still after it.
      expect(labels[0]).toBe('Change gear')
      expect(labels).toContain('Edit post')
      expect(labels).toContain('Change visibility')
      expect(labels).toContain('Delete post')
    })
  })
})
