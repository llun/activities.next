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

// The picker chunk fails to download (a deploy renamed it under an open tab).
vi.mock('@/lib/components/posts/reaction-picker', () => ({
  get ReactionPicker(): never {
    throw new Error('Loading chunk failed')
  }
}))

// The App Router's `next/dynamic` (React.lazy based), which rethrows a failed
// import as a render error; vitest otherwise resolves the Pages Router one.
vi.mock('next/dynamic', async () => ({
  default: (await import('next/dist/shared/lib/app-dynamic')).default
}))

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

const Harness = () => {
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
      onShowAttachment={vi.fn()}
    />
  )
}

const reactFromMenu = async () => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), {
    key: 'ArrowDown'
  })
  const menu = await screen.findByRole('menu')
  fireEvent.click(
    await within(menu).findByRole('menuitem', { name: 'React to post' })
  )
}

describe('Actions compact reaction picker chunk failure', () => {
  beforeEach(() => {
    // React logs the caught render error; the boundary is what is under test.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('lets the ⋯ menu item close the "Couldn\'t load" message', async () => {
    observeWidth(320)
    render(<Harness />)

    await reactFromMenu()
    await screen.findByText("Couldn't load")

    await reactFromMenu()
    await waitFor(() =>
      expect(screen.queryByText("Couldn't load")).not.toBeInTheDocument()
    )
    // Closing from the menu must not strand focus on <body>.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    )
  })
})
