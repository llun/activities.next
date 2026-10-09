/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'
import { resolveStatusFromPath } from './resolveStatusFromPath'

vi.mock('next/navigation', async () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() })),
  usePathname: vi.fn(() => '/@alice@example.com/status-1')
}))

vi.mock('@/lib/config', async () => ({
  getConfig: vi.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined
  }))
}))

const mockGetStatus = vi.fn()
const mockGetStatusReplies = vi.fn()
const mockGetAcceptedOrRequestedFollow = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: vi.fn(() => ({
    getStatus: mockGetStatus,
    getStatusReplies: mockGetStatusReplies,
    getAcceptedOrRequestedFollow: mockGetAcceptedOrRequestedFollow,
    // Read only by the real resolver, which the off-site Back test runs.
    getActorFromUsername: vi.fn(async () => null),
    getStatusFromUrlHash: vi.fn(async () => null),
    getStatusFromPublicId: vi.fn(async () => null),
    // Without this the page's settings read throws and every test logs an
    // error while quietly exercising the env/default fallback path.
    getAllServerSettings: vi.fn(async () => [])
  }))
}))

vi.mock('@/lib/services/auth/getSession', async () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', async () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('@/lib/config/mapProvider', async () => ({
  getMapProviderConfig: vi.fn(() => ({ type: 'osm' })),
  getPublicMapProvider: vi.fn(() => ({ type: 'osm' }))
}))

vi.mock('./resolveStatusFromPath', async () => ({
  ...(await vi.importActual('./resolveStatusFromPath')),
  resolveStatusFromPath: vi.fn()
}))

vi.mock('./RemoteStatusLoading', async () => ({
  RemoteStatusLoading: () => null
}))

vi.mock('./StatusBox', async () => ({
  StatusBox: ({ status }: { status: { id: string } }) => (
    <div data-testid={`status-${status.id}`} />
  )
}))

vi.mock('./StatusLikes', async () => ({
  StatusLikes: () => null
}))

const mockResolveStatusFromPath = vi.mocked(resolveStatusFromPath)
// The handle the mocked resolver reports for the `actor` segment.
const PATH_ACTOR = { username: 'anna', domain: 'activities.local' }
const mockGetServerAuthSession = vi.mocked(getServerAuthSession)
const mockGetActorFromSession = vi.mocked(getActorFromSession)

const AUTHOR_ID = 'https://activities.local/users/anna'
const VIEWER_ID = 'https://activities.local/users/viewer'

const buildNote = (overrides: Partial<StatusNote> = {}): StatusNote => ({
  id: 'note-id',
  type: 'Note',
  actorId: AUTHOR_ID,
  actor: null,
  url: `${AUTHOR_ID}/statuses/note-id`,
  text: 'body',
  reply: '',
  replies: [],
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: [],
  edits: [],
  isLocalActor: true,
  isActorLiked: false,
  isActorBookmarked: false,
  actorAnnounceStatusId: null,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

// `isFitnessDashboard` keys off a completed fitness file, and that branch is a
// separate card from the conversation one below — same defect, its own chrome.
const buildFitnessNote = (): StatusNote =>
  buildNote({
    id: 'ride-1',
    url: `${AUTHOR_ID}/statuses/ride-1`,
    fitness: {
      id: 'fit-1',
      fileName: 'ride.fit',
      fileType: 'fit',
      mimeType: 'application/octet-stream',
      bytes: 1000,
      url: 'https://activities.local/files/fit-1',
      processingStatus: 'completed',
      activityType: 'ride',
      hasMapData: false
    }
  })

const buildViewer = (): Actor => ({
  id: VIEWER_ID,
  type: 'Person',
  username: 'viewer',
  domain: 'activities.local',
  followersUrl: `${VIEWER_ID}/followers`,
  inboxUrl: `${VIEWER_ID}/inbox`,
  sharedInboxUrl: 'https://activities.local/inbox',
  publicKey: 'public-key',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: 1,
  updatedAt: 1
})

const renderPage = async () => {
  const element = await Page({
    params: Promise.resolve({
      actor: '@anna@activities.local',
      status: 'hash'
    })
  })
  const { container } = render(element)
  return container.firstElementChild as HTMLElement
}

// Collects every clip between the card and a post, inclusive of both. The
// panel opens upward *out of the post*, so a clip anywhere on that path cuts
// it off — checking only the card left "move the class down one level" as a
// green mutation. Matches on the prefix rather than `overflow-hidden` alone
// because `overflow-x-hidden` forces the computed `overflow-y` to `auto`,
// which re-clips the panel vertically. `overflow-visible`/`overflow-x-clip`
// would be rejected too; neither is needed here, so allowing none is the
// simplest honest guard.
// Shared by both cards: each wraps posts, and neither may clip them.
const clipsBetween = (card: HTMLElement, statusId: string) => {
  const found: string[] = []
  let node: HTMLElement | null = screen.getByTestId(`status-${statusId}`)
  while (node && node !== card.parentElement) {
    found.push(
      ...Array.from(node.classList).filter((name) =>
        name.startsWith('overflow-')
      )
    )
    node = node.parentElement
  }
  return found
}

// `StatusBox` is mocked to a bare testid div, so the row that carries a post's
// radius is its parent. Anchoring on the status rather than a child index keeps
// the assertion meaningful if a card gains another child.
const rowFor = (statusId: string) =>
  screen.getByTestId(`status-${statusId}`).parentElement

describe('Mobile chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    mockGetStatusReplies.mockResolvedValue([])
  })

  it.each([
    { note: buildNote({ id: 'focused' }), title: 'Post' },
    { note: buildFitnessNote(), title: 'Activity' }
  ])(
    'renders the compact bar titled $title above the card, and points Back at the author',
    async ({ note, title }) => {
      mockResolveStatusFromPath.mockResolvedValue({
        pathActor: PATH_ACTOR,
        status: note,
        statusId: note.id,
        fullStatusId: note.url,
        isStatusHash: true
      })
      const element = await Page({
        params: Promise.resolve({
          actor: '%40anna%40activities.local',
          status: 'hash'
        })
      })
      const { container } = render(
        <MobileNavigationProvider>{element}</MobileNavigationProvider>
      )

      const bar = container.firstElementChild as HTMLElement
      expect(bar).toHaveAttribute('data-mobile-compact-header')
      expect(
        within(bar).getByRole('heading', { level: 1, name: title })
      ).toBeInTheDocument()
      expect(bar.nextElementSibling).toHaveClass('rounded-2xl')
      // One menu button per screen: the bar's. The card's Back row must not
      // bring its own.
      const triggers = screen.getAllByRole('button', {
        name: 'Open navigation'
      })
      expect(triggers).toHaveLength(1)
      expect(bar).toContainElement(triggers[0])
      // Direct entry: no in-app page precedes this one in the test, so the
      // Back is the decoded author profile link, named by the handle when the
      // status carries no author profile.
      const back = screen.getByRole('link', {
        name: 'Back to profile, @anna@activities.local'
      })
      expect(back).toHaveAttribute('href', '/@anna@activities.local')
      expect(back).toHaveTextContent(/^Back to profile$/)
    }
  )

  // The fallback's accessible name carries the author's display name when the
  // status is theirs; a status by someone else (a mismatched path) names the
  // handle from the path instead.
  it.each([
    {
      description: 'the author',
      author: { username: 'Anna', domain: 'activities.local' },
      accessibleName: 'Back to profile, Anna Nowak'
    },
    {
      description: 'the author (domain in other case)',
      author: { username: 'Anna', domain: 'Activities.Local' },
      accessibleName: 'Back to profile, Anna Nowak'
    },
    {
      description: 'someone else (handle from the path)',
      author: { username: 'someone', domain: 'elsewhere.example' },
      accessibleName: 'Back to profile, @anna@activities.local'
    },
    // The same username on another server is someone else.
    {
      description: 'the same username on another server',
      author: { username: 'anna', domain: 'elsewhere.example' },
      accessibleName: 'Back to profile, @anna@activities.local'
    }
  ])(
    'names the direct-entry Back after $description',
    async ({ author, accessibleName }) => {
      const note = buildNote({
        id: 'focused',
        actor: {
          ...author,
          name: 'Anna Nowak'
        } as unknown as StatusNote['actor']
      })
      mockResolveStatusFromPath.mockResolvedValue({
        pathActor: PATH_ACTOR,
        status: note,
        statusId: note.id,
        fullStatusId: note.url,
        isStatusHash: true
      })
      const element = await Page({
        params: Promise.resolve({
          actor: '%40anna%40activities.local',
          status: 'hash'
        })
      })
      render(<MobileNavigationProvider>{element}</MobileNavigationProvider>)

      const back = screen.getByRole('link', { name: accessibleName })
      expect(back).toHaveAttribute('href', '/@anna@activities.local')
      expect(back).toHaveTextContent(/^Back to profile$/)
    }
  )
})

// The resolver reads only the two parts after the first '@', so a segment that
// decodes to `//x@u@attacker.example` (or `\x@…`) still resolves any public
// status by its full URL. The Back fallback must come from the parsed handle:
// `/${segment}` would be `///x@…`, which next/link treats as off-site.
describe('Back to profile fallback from an untrusted actor segment', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(buildViewer())
    mockGetStatusReplies.mockResolvedValue([])
    // The real resolver, so the test proves such a path renders at all.
    const actual = await vi.importActual<
      typeof import('./resolveStatusFromPath')
    >('./resolveStatusFromPath')
    mockResolveStatusFromPath.mockImplementation(actual.resolveStatusFromPath)
  })

  it.each(['%2F%2Fx%40u%40attacker.example', '%5Cx%40u%40attacker.example'])(
    'stays on this site for %s',
    async (actor) => {
      const note = buildNote({ id: 'focused' })
      mockGetStatus.mockResolvedValue(note)

      const element = await Page({
        params: Promise.resolve({
          actor,
          status: encodeURIComponent(note.url)
        })
      })
      render(<MobileNavigationProvider>{element}</MobileNavigationProvider>)

      expect(screen.getByTestId('status-focused')).toBeInTheDocument()
      expect(
        screen.getByRole('link', {
          name: 'Back to profile, @u@attacker.example'
        })
      ).toHaveAttribute('href', '/@u@attacker.example')
    }
  )
})

describe('Conversation card chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])

    const focused = buildNote({ id: 'focused' })
    mockResolveStatusFromPath.mockResolvedValue({
      pathActor: PATH_ACTOR,
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
  })

  // The card wraps posts, and the edit-history panel — which is not portalled
  // — opens upward out of it. `Posts` dropped `overflow-hidden` for the same
  // reason. Clipping here was what a comment on this card wrongly claimed was
  // already gone, so pin it off rather than trusting the comment.
  it('does not clip its children, so post overlays can escape it', async () => {
    // Signed in on purpose: a logged-out viewer gets no action row at all, so
    // there is no overlay to clip and the assertion would be vacuous.
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()

    expect(clipsBetween(card, 'focused')).toEqual([])
  })

  it('leads with the header wrapper for a signed-in viewer', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()

    // The wrapper, not the header itself: `Header` is `sticky top-0`, so it
    // has to keep a wrapper of its own.
    expect(card.firstElementChild).toContainElement(
      screen.getByRole('heading', { name: 'Post' })
    )
    expect(card.firstElementChild).not.toContainElement(
      screen.getByTestId('status-focused')
    )
  })

  it('puts the thread first and the sign-in callout last when logged out', async () => {
    const card = await renderPage()

    // The thread is the first card…
    const thread = rowFor('focused')?.parentElement as HTMLElement
    expect(thread.parentElement).toBe(card)
    // …and the sign-in callout is the second.
    const callout = screen
      .getByText('Join the conversation')
      .closest('div.bg-primary\\/5')
    expect(callout?.parentElement).toBe(card)
    expect(card.lastElementChild).toBe(callout)
  })

  it('leads with an sr-only heading when logged out, which has no header', async () => {
    const card = await renderPage()

    // The logged-out branch leads with an `sr-only` heading, which is out of
    // flow and paints nothing — and stays in the accessibility tree at every
    // width: a logged-out visitor has no mobile bar to carry the page's h1.
    expect(card.firstElementChild).toHaveClass('sr-only')
    expect(card.firstElementChild).not.toHaveClass('max-md:hidden')
  })

  // Nothing clips for the rounded corners, so the one row that meets them has
  // to round itself or its square background bleeds past the border. Exactly
  // one row may do so — a second would notch a rounded row into the middle of
  // the card. Logged out that is the topmost row (the focused post, or the
  // topmost ancestor: with a single ancestor `index === 0` and
  // `index === previouses.length - 1` are the same row, so a chain of two is
  // what tells them apart). A signed-in viewer gets the header above everything,
  // so neither guard may fire; deleting either would leave a rounded row notched
  // into the middle of the card.
  it.each([
    {
      name: 'the focused post when logged out',
      signedIn: false,
      ancestors: [],
      rounded: 'focused'
    },
    {
      name: 'the first ancestor row when logged out and the post is a reply',
      signedIn: false,
      ancestors: ['parent'],
      rounded: 'parent'
    },
    {
      name: 'only the topmost ancestor when the chain is longer than one',
      signedIn: false,
      ancestors: ['parent', 'grandparent'],
      rounded: 'grandparent'
    },
    {
      name: 'neither the ancestor row nor the post for a signed-in viewer',
      signedIn: true,
      ancestors: ['parent'],
      rounded: null
    }
  ])('rounds $name', async ({ signedIn, ancestors, rounded }) => {
    if (signedIn) mockGetActorFromSession.mockResolvedValue(buildViewer())
    const chain = ['focused', ...ancestors]
    const replyOf = (id: string) => chain[chain.indexOf(id) + 1] ?? ''
    const focused = buildNote({ id: 'focused', reply: replyOf('focused') })
    mockResolveStatusFromPath.mockResolvedValue({
      pathActor: PATH_ACTOR,
      status: focused,
      statusId: 'focused',
      fullStatusId: focused.url,
      isStatusHash: true
    })
    mockGetStatus.mockImplementation(
      async ({ statusId }: { statusId: string }) =>
        buildNote({ id: statusId, reply: replyOf(statusId) })
    )

    await renderPage()

    for (const id of chain) {
      if (id === rounded) {
        expect(rowFor(id)).toHaveClass('rounded-t-2xl')
      } else {
        expect(rowFor(id)).not.toHaveClass('rounded-t-2xl')
      }
    }
  })
})

// The other card `page.tsx` can return: a completed fitness file takes the
// `isFitnessDashboard` branch instead of the conversation one above. It has the
// same reason to stop clipping — `FitnessStatusDetail` ends its own header card
// with the shared `<Actions>` row, whose error tooltips and edit-history panel
// do not portal — and unclipping only that inner card was not enough, because
// the like button's tooltip starts left of this card as well as below it.
describe('Fitness activity card chrome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetActorFromSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])

    const focused = buildFitnessNote()
    mockResolveStatusFromPath.mockResolvedValue({
      pathActor: PATH_ACTOR,
      status: focused,
      statusId: 'ride-1',
      fullStatusId: focused.url,
      isStatusHash: true
    })
  })

  it('does not clip its children, so post overlays can escape it', async () => {
    // Signed in on purpose: a logged-out viewer gets no action row at all, so
    // there is no overlay to clip and the assertion would be vacuous.
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()

    expect(clipsBetween(card, 'ride-1')).toEqual([])
  })

  // Every child here paints a background, so with the clip gone each corner a
  // child reaches has to be rounded by that child. That is only right while the
  // header wrapper stays first and the post block stays last: append another
  // painted block and a rounded row is notched into the middle of the card.
  it('keeps the header wrapper first and the post block last for a signed-in viewer', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const card = await renderPage()

    expect(card.firstElementChild).toContainElement(
      screen.getByRole('heading', { name: 'Activity' })
    )
    expect(card.lastElementChild).toBe(rowFor('ride-1'))
  })

  it('puts the activity first and the sign-in callout last when logged out', async () => {
    const card = await renderPage()

    // Anchored on the callout's own text rather than a child index, so this
    // keeps meaning the right element if the card gains another block.
    const activity = rowFor('ride-1') as HTMLElement
    expect(activity.parentElement).toBe(card)
    const callout = screen
      .getByText('Join the conversation')
      .closest('div.bg-primary\\/5')
    expect(callout?.parentElement).toBe(card)
    expect(card.lastElementChild).toBe(callout)
  })

  it('leads with an sr-only heading when logged out, which has no header', async () => {
    const card = await renderPage()

    // The logged-out branch leads with an `sr-only` heading, which is out of
    // flow and paints nothing — and stays in the accessibility tree at every
    // width: a logged-out visitor has no mobile bar to carry the page's h1.
    expect(card.firstElementChild).toHaveClass('sr-only')
    expect(card.firstElementChild).not.toHaveClass('max-md:hidden')
  })
})
