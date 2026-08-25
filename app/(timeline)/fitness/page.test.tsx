import { ReactElement, isValidElement } from 'react'

import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

import { ActorFitnessDashboard } from './ActorFitnessDashboard'
import { RecentFitnessActivities } from './RecentFitnessActivities'
import Page from './page'

const mockGetConfig = vi.fn()
const mockGetDatabase = vi.fn()
const mockGetServerAuthSession = vi.fn()
const mockGetActorFromSession = vi.fn()

vi.mock('@/lib/config', () => ({
  getConfig: () => mockGetConfig()
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockGetDatabase()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockGetServerAuthSession()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: (...args: unknown[]) => mockGetActorFromSession(...args)
}))

vi.mock('./ActorFitnessDashboard', () => ({
  ActorFitnessDashboard: () => null
}))

vi.mock('./RecentFitnessActivities', () => ({
  RecentFitnessActivities: () => null
}))

const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()

const currentActor = {
  id: 'https://example.com/users/me',
  username: 'me',
  domain: 'example.com',
  name: 'Me',
  account: { id: 'account-1' },
  followersUrl: 'https://example.com/users/me/followers',
  inboxUrl: 'https://example.com/users/me/inbox',
  sharedInboxUrl: 'https://example.com/inbox',
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime,
  updatedAt: currentTime,
  publicKey: 'public-key'
}

// The status author as `Status` carries it: an `ActorProfile`, which is
// deliberately narrower than the `Actor` the session resolves to.
const profile: ActorProfile = {
  id: currentActor.id,
  username: currentActor.username,
  domain: currentActor.domain,
  name: currentActor.name,
  followersUrl: currentActor.followersUrl,
  inboxUrl: currentActor.inboxUrl,
  sharedInboxUrl: currentActor.sharedInboxUrl,
  followingCount: 0,
  followersCount: 0,
  statusCount: 0,
  lastStatusAt: null,
  createdAt: currentTime
}

const status = (id: string): Status => ({
  id,
  actorId: profile.id,
  actor: profile,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: id,
  text: id,
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
})

// Only the fields the page reads off a row; the page hands the whole row to
// nothing but `statusId`.
const fitnessFile = (statusId: string) =>
  ({ id: `file-${statusId}`, statusId }) as FitnessFile

/**
 * The page's own element tree, not a render: both children are mocked to
 * nothing, so what is under test is which props they were handed.
 */
const findElementByType = (
  node: unknown,
  type: unknown
): ReactElement | null => {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElementByType(child, type)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (node.type === type) return node
  return findElementByType(
    (node.props as { children?: unknown }).children,
    type
  )
}

const createDatabase = () => ({
  getActorHasFitnessData: vi.fn().mockResolvedValue(true),
  getFitnessFilesByActor: vi
    .fn()
    .mockResolvedValue([fitnessFile('https://example.com/users/me/s/1')]),
  getStatus: vi
    .fn()
    .mockResolvedValue(status('https://example.com/users/me/s/1'))
})

describe('fitness page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ host: 'example.com' })
    mockGetServerAuthSession.mockResolvedValue({ user: { id: 'account-1' } })
    mockGetActorFromSession.mockResolvedValue(currentActor)
  })

  it('lists every activity type when no filter is asked for', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    // An absent key, not `activityType: undefined`: the database method reads
    // `null` as "no recorded type" and only an absent key as "every type".
    expect(database.getFitnessFilesByActor).toHaveBeenCalledWith({
      actorId: currentActor.id,
      limit: 5,
      processingStatus: 'completed',
      isPrimary: true
    })
    expect(
      findElementByType(element, RecentFitnessActivities)?.props
    ).toMatchObject({ activityType: undefined })
    expect(
      findElementByType(element, ActorFitnessDashboard)?.props
    ).toMatchObject({ selectedActivityType: undefined })
  })

  it('narrows the recent activities to the requested activity type', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({
      searchParams: Promise.resolve({ activity: 'gravel_ride' })
    })

    expect(database.getFitnessFilesByActor).toHaveBeenCalledWith({
      actorId: currentActor.id,
      limit: 5,
      processingStatus: 'completed',
      isPrimary: true,
      activityType: 'gravel_ride'
    })
    expect(
      findElementByType(element, RecentFitnessActivities)?.props
    ).toMatchObject({ activityType: 'gravel_ride' })
    // The table row the reader clicked has to read as the selected one, and it
    // learns that from the same param the query above was built from.
    expect(
      findElementByType(element, ActorFitnessDashboard)?.props
    ).toMatchObject({ selectedActivityType: 'gravel_ride' })
  })

  // How a param is read is `activityFilter.test.ts`; what this asserts is that
  // "no filter" leaves the key off the query entirely rather than passing
  // `activityType: undefined`, which the database method reads differently.
  it('leaves the filter off the query for a blank param', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    await Page({ searchParams: Promise.resolve({ activity: '' }) })

    expect(database.getFitnessFilesByActor).toHaveBeenCalledWith({
      actorId: currentActor.id,
      limit: 5,
      processingStatus: 'completed',
      isPrimary: true
    })
  })
})
