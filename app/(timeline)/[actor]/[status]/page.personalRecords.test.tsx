/**
 * @vitest-environment jsdom
 * @vitest-size medium
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import Page from './page'
import { resolveStatusFromPath } from './resolveStatusFromPath'

// The page reads the sign-ups of the domain it is visited on, which needs a
// request; these tests render the page directly, so answer for the primary.
vi.mock('@/lib/services/domains/visitedSignUpDomain', () => ({
  getVisitedSignUpDomain: vi.fn(async () => ({
    domain: 'test.llun.dev',
    displayName: 'Activities',
    source: 'primary',
    open: true,
    allowEmails: []
  }))
}))

vi.mock('next/navigation', async () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  useRouter: vi.fn(() => ({ back: vi.fn(), push: vi.fn(), refresh: vi.fn() })),
  usePathname: vi.fn(() => '/@alice@example.com/status-1')
}))

vi.mock('@/lib/config', async () => ({
  getBaseURL: vi.fn(() => 'https://activities.local'),
  getConfig: vi.fn(() => ({
    host: 'activities.local',
    fitnessStorage: undefined,
    mediaStorage: undefined
  }))
}))

const mockGetStatus = vi.fn()
const mockGetStatusReplies = vi.fn()
const mockGetActorDomainBlocks = vi.fn(async () => [])
// getStatusContext walks the reply tree through getStatusReplyRefs; derive the
// tree from whatever getStatusReplies is set to return.
const mockGetStatusReplyRefs = vi.fn(
  async ({ statusId, url }: { statusId: string; url?: string }) => {
    const rows = ((await mockGetStatusReplies.getMockImplementation()?.({
      statusId,
      url
    })) ?? []) as Array<{
      id: string
      url?: string
      reply?: string
      createdAt: unknown
    }>
    return rows
      .filter(
        (row) => row.reply === statusId || (Boolean(url) && row.reply === url)
      )
      .map((row) => ({
        id: row.id,
        url: row.url ?? null,
        createdAt: row.createdAt
      }))
  }
)
const mockGetAcceptedOrRequestedFollow = vi.fn()

vi.mock('@/lib/database', async () => ({
  getDatabase: vi.fn(() => ({
    getStatus: mockGetStatus,
    getStatusReplies: mockGetStatusReplies,
    getStatusReplyRefs: mockGetStatusReplyRefs,
    getActorDomainBlocks: mockGetActorDomainBlocks,
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

const mockStatusBox = vi.fn()
vi.mock('./StatusBox', async () => ({
  StatusBox: (props: { status: { id: string } }) => {
    mockStatusBox(props)
    return <div data-testid={`status-${props.status.id}`} />
  }
}))

const mockGetPersonalRecordDurations = vi.fn()
vi.mock('@/lib/services/fitness-files/personalRecords', () => ({
  getPersonalRecordDurations: (...args: unknown[]) =>
    mockGetPersonalRecordDurations(...args)
}))

vi.mock('@/lib/services/fitness-files/statusFitnessFiles', () => ({
  getStatusFitnessFiles: vi.fn(async () => [{ id: 'fit-1' }, { id: 'fit-2' }])
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

const buildAuthor = (): Actor => ({
  ...buildViewer(),
  id: AUTHOR_ID,
  username: 'anna',
  followersUrl: `${AUTHOR_ID}/followers`,
  inboxUrl: `${AUTHOR_ID}/inbox`
})

const renderActivityPage = async (note: StatusNote = buildFitnessNote()) => {
  mockResolveStatusFromPath.mockResolvedValue({
    pathActor: PATH_ACTOR,
    status: note,
    statusId: note.id,
    fullStatusId: note.url,
    isStatusHash: true
  })
  const element = await Page({
    params: Promise.resolve({
      actor: '@anna@activities.local',
      status: 'hash'
    })
  })
  render(element)
  expect(screen.getByTestId(`status-${note.id}`)).toBeInTheDocument()
  return mockStatusBox.mock.calls.at(-1)?.[0] as {
    personalRecordDurations?: Record<string, number[]>
  }
}

describe('activity page personal records', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetStatus.mockReset()
    mockGetServerAuthSession.mockResolvedValue(null)
    mockGetStatusReplies.mockResolvedValue([])
    mockGetPersonalRecordDurations.mockResolvedValue({ 'fit-1': [5, 60] })
  })

  it('reads the owner’s PR durations for every recording and passes them on', async () => {
    mockGetActorFromSession.mockResolvedValue(buildAuthor())

    const props = await renderActivityPage()

    expect(mockGetPersonalRecordDurations).toHaveBeenCalledTimes(1)
    expect(mockGetPersonalRecordDurations).toHaveBeenCalledWith(
      expect.anything(),
      { actorId: AUTHOR_ID, fitnessFileIds: ['fit-1', 'fit-2'] }
    )
    expect(props.personalRecordDurations).toEqual({ 'fit-1': [5, 60] })
  })

  it('reads nothing for another signed-in actor', async () => {
    mockGetActorFromSession.mockResolvedValue(buildViewer())

    const props = await renderActivityPage()

    expect(mockGetPersonalRecordDurations).not.toHaveBeenCalled()
    expect(props.personalRecordDurations).toBeUndefined()
  })

  it('reads nothing for a signed-out visitor', async () => {
    mockGetActorFromSession.mockResolvedValue(null)

    const props = await renderActivityPage()

    expect(mockGetPersonalRecordDurations).not.toHaveBeenCalled()
    expect(props.personalRecordDurations).toBeUndefined()
  })

  it('reads nothing for a remote post, even one claiming the viewer’s id', async () => {
    mockGetActorFromSession.mockResolvedValue(buildAuthor())

    const props = await renderActivityPage({
      ...buildFitnessNote(),
      isLocalActor: false
    })

    expect(mockGetPersonalRecordDurations).not.toHaveBeenCalled()
    expect(props.personalRecordDurations).toBeUndefined()
  })

  it('still renders the activity when the read fails', async () => {
    mockGetActorFromSession.mockResolvedValue(buildAuthor())
    mockGetPersonalRecordDurations.mockRejectedValue(new Error('db down'))

    const props = await renderActivityPage()

    expect(mockGetPersonalRecordDurations).toHaveBeenCalledTimes(1)
    expect(props.personalRecordDurations).toBeUndefined()
  })
})
