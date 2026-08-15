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

import { useReactionState } from '@/lib/components/posts/useReactionState'
import type { ActorProfile } from '@/lib/types/domain/actor'
import { StatusNote, StatusType } from '@/lib/types/domain/status'

import { Actions } from './actions'
import type { PostMenuExtraItem } from './post-menu'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() })
}))

vi.mock('@/lib/client', () => ({
  bookmarkStatus: vi.fn(),
  undoBookmarkStatus: vi.fn(),
  deleteStatus: vi.fn(),
  likeStatus: vi.fn(),
  undoLikeStatus: vi.fn(),
  repostStatus: vi.fn(),
  undoRepostStatus: vi.fn(),
  updateStatusVisibility: vi.fn(),
  updateStatusInteractionPolicy: vi.fn(),
  getRelationship: vi.fn().mockResolvedValue(null),
  mute: vi.fn(),
  unmute: vi.fn(),
  block: vi.fn(),
  unblock: vi.fn(),
  createReport: vi.fn(),
  reactToStatus: vi.fn(),
  unreactFromStatus: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([])
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
  text: 'A ride',
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

// jsdom has no ResizeObserver and lays nothing out, so stand one in that
// reports the width the test chooses — the row measures its own container
// rather than the viewport, which is what decides compact vs. full.
const observeWidth = (width: number) => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(
        private readonly callback: (entries: ResizeObserverEntry[]) => void
      ) {}
      observe(target: Element) {
        this.callback([
          {
            target,
            contentRect: { width } as DOMRectReadOnly
          } as ResizeObserverEntry
        ])
      }
      unobserve() {}
      disconnect() {}
    }
  )
}

const gearItem: PostMenuExtraItem = {
  key: 'change-gear',
  icon: <span />,
  label: 'Change gear',
  items: [
    { key: 'gear-bike', label: 'Moots', checked: true, onSelect: vi.fn() },
    { key: 'no-gear', label: 'No gear', checked: false, onSelect: vi.fn() }
  ]
}

// A thin harness so the row gets the same `ReactionState` a real surface hands
// it — the hook has to run inside a component.
const ActionsHarness = ({
  extraMenuItems
}: {
  extraMenuItems?: PostMenuExtraItem[]
}) => {
  const reactionState = useReactionState({ currentActor: actor, status })
  return (
    <Actions
      host="activities.local"
      currentActor={actor}
      currentTime={currentTime}
      status={status}
      showActions
      editable
      reactionState={reactionState}
      extraMenuItems={extraMenuItems}
      onShowAttachment={vi.fn()}
    />
  )
}

const openMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  return screen.findByRole('menu')
}

describe('Actions', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('extraMenuItems', () => {
    it('hands a surface-specific item to the shared ⋯ menu', async () => {
      observeWidth(900)
      render(<ActionsHarness extraMenuItems={[gearItem]} />)

      const menu = await openMenu()
      expect(
        within(menu).getByRole('menuitem', { name: 'Change gear' })
      ).toBeInTheDocument()
      // It can only ADD: the menu's own items are all still there.
      expect(
        within(menu).getByRole('menuitem', { name: 'Edit post' })
      ).toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'Delete post' })
      ).toBeInTheDocument()
    })

    it('leaves the menu unchanged when a surface adds nothing', async () => {
      observeWidth(900)
      render(<ActionsHarness />)

      const menu = await openMenu()
      expect(
        within(menu).queryByRole('menuitem', { name: 'Change gear' })
      ).not.toBeInTheDocument()
      expect(
        within(menu).getByRole('menuitem', { name: 'Edit post' })
      ).toBeInTheDocument()
    })

    it('keeps the row’s own displaced actions nearest the row it came from', async () => {
      // Under 400px the row hands bookmark and react to the menu. Those are
      // buttons that were in the row a moment ago, so they stay above a
      // surface's own additions.
      observeWidth(320)
      render(<ActionsHarness extraMenuItems={[gearItem]} />)

      const menu = await openMenu()
      await waitFor(() =>
        expect(
          within(menu).getByRole('menuitem', { name: 'React to post' })
        ).toBeInTheDocument()
      )
      const labels = within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
      expect(labels.slice(0, 3)).toEqual([
        'React to post',
        'Bookmark',
        'Change gear'
      ])
    })
  })
})
