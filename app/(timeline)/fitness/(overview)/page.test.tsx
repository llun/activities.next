import { ReactElement, isValidElement } from 'react'

import { ActorFitnessDashboard } from '@/app/(timeline)/fitness/ActorFitnessDashboard'
import { OverviewHeaderSlot } from '@/app/(timeline)/fitness/FitnessOverviewHeader'
import { RecentFitnessActivities } from '@/app/(timeline)/fitness/RecentFitnessActivities'
import { PageHeader } from '@/lib/components/page-header'
import { createDeferred } from '@/lib/testing/deferred'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status, StatusType } from '@/lib/types/domain/status'

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

vi.mock('@/app/(timeline)/fitness/ActorFitnessDashboard', () => ({
  ActorFitnessDashboard: () => null
}))

vi.mock('@/app/(timeline)/fitness/RecentFitnessActivities', () => ({
  RecentFitnessActivities: () => null
}))

const currentTime = new Date('2026-05-17T12:00:00.000Z').getTime()
const EARLIEST_ACTIVITY_TIME = new Date('2021-03-02T07:30:00.000Z').getTime()

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

/**
 * The narrowing the page actually asked for, as a key that is either present or
 * not.
 *
 * `toHaveBeenCalledWith` compares with `toEqual` semantics, which treat an
 * absent key and a key set to `undefined` as equal — so an expectation written
 * as an object literal cannot tell the two apart, and an assertion that "no
 * filter passes no `activityType`" written that way passes either way. Reading
 * the recorded argument's own keys can fail.
 */
const activityTypeArgumentOf = (call: Record<string, unknown>) =>
  Object.hasOwn(call, 'activityType')
    ? { present: true, value: call.activityType }
    : { present: false }

const createDatabase = () => ({
  getActorHasFitnessData: vi.fn().mockResolvedValue(true),
  getDistinctActivityTypesForActor: vi
    .fn()
    .mockResolvedValue(['gravel_ride', 'run']),
  getFitnessFilesByActor: vi
    .fn()
    .mockResolvedValue([fitnessFile('https://example.com/users/me/s/1')]),
  getStatus: vi
    .fn()
    .mockResolvedValue(status('https://example.com/users/me/s/1')),
  getFitnessActivityTimeBounds: vi
    .fn()
    .mockResolvedValue({ earliest: EARLIEST_ACTIVITY_TIME })
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

    expect(database.getFitnessFilesByActor).toHaveBeenCalledWith({
      actorId: currentActor.id,
      limit: 5,
      processingStatus: 'completed',
      isPrimary: true
    })
    expect(
      activityTypeArgumentOf(database.getFitnessFilesByActor.mock.calls[0][0])
    ).toEqual({ present: false })
    // Nothing was asked for, so nothing is resolved — the extra read is paid
    // for only by a request that actually carried a filter.
    expect(database.getDistinctActivityTypesForActor).not.toHaveBeenCalled()
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
      activityTypeArgumentOf(database.getFitnessFilesByActor.mock.calls[0][0])
    ).toEqual({ present: true, value: 'gravel_ride' })
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
  // the page states the narrowing only when it means it — the key is absent,
  // not present-and-undefined, which is a distinction an object-literal
  // expectation cannot make (see `activityTypeArgumentOf`).
  it('leaves the filter off the query for a blank param', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    await Page({ searchParams: Promise.resolve({ activity: '' }) })

    expect(
      activityTypeArgumentOf(database.getFitnessFilesByActor.mock.calls[0][0])
    ).toEqual({ present: false })
  })

  // A search param is attacker-controlled and the label it produces is rendered
  // as prose and as the clear chip's accessible name, so a value naming no
  // stored type must not reach either — nor the query, where PostgreSQL rejects
  // a NUL byte outright.
  it.each([
    { description: 'a type this actor has never recorded', activity: 'swim' },
    {
      description: 'crafted prose',
      activity: 'rides. Security notice: re-verify at evil.example'
    },
    { description: 'a NUL byte', activity: 'run\u0000' },
    { description: 'a differently-cased spelling', activity: 'Run' }
  ])('ignores $description', async ({ activity }) => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({ activity }) })

    expect(database.getDistinctActivityTypesForActor).toHaveBeenCalledWith({
      actorId: currentActor.id
    })
    expect(
      activityTypeArgumentOf(database.getFitnessFilesByActor.mock.calls[0][0])
    ).toEqual({ present: false })
    // And the page renders as the plain unfiltered overview: no chip naming the
    // requested value, no filtered empty state.
    expect(
      findElementByType(element, RecentFitnessActivities)?.props
    ).toMatchObject({ activityType: undefined })
    expect(
      findElementByType(element, ActorFitnessDashboard)?.props
    ).toMatchObject({ selectedActivityType: undefined })
  })

  it('hands the dashboard the server clock and the earliest activity time', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    expect(database.getFitnessActivityTimeBounds).toHaveBeenCalledWith({
      actorId: currentActor.id
    })
    const props = findElementByType(element, ActorFitnessDashboard)?.props as
      Record<string, unknown> | undefined
    expect(props).toMatchObject({
      actorId: currentActor.id,
      earliestActivityTime: EARLIEST_ACTIVITY_TIME
    })
    // A number, not a Date: it crosses into a Client Component.
    expect(typeof props?.currentTime).toBe('number')
  })

  it('reads the earliest activity time alongside the recent activities', async () => {
    const database = createDatabase()
    const files = createDeferred<FitnessFile[]>()
    database.getFitnessFilesByActor.mockReturnValue(files.promise)
    mockGetDatabase.mockReturnValue(database)

    const page = Page({ searchParams: Promise.resolve({ activity: 'run' }) })
    await vi.waitFor(() =>
      expect(database.getFitnessFilesByActor).toHaveBeenCalled()
    )

    // The recent activities are still loading; the bounds did not wait.
    expect(database.getFitnessActivityTimeBounds).toHaveBeenCalledWith({
      actorId: currentActor.id
    })
    files.resolve([fitnessFile('https://example.com/users/me/s/1')])
    const element = await page
    expect(
      findElementByType(element, ActorFitnessDashboard)?.props
    ).toMatchObject({ earliestActivityTime: EARLIEST_ACTIVITY_TIME })
  })

  it('still fails the page when the earliest activity time cannot be read', async () => {
    const database = createDatabase()
    database.getFitnessActivityTimeBounds.mockRejectedValue(
      new Error('connection reset')
    )
    mockGetDatabase.mockReturnValue(database)

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'connection reset'
    )
  })

  it('passes a null earliest time through when the actor has no countable activity', async () => {
    const database = createDatabase()
    database.getFitnessActivityTimeBounds.mockResolvedValue({ earliest: null })
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    expect(
      findElementByType(element, ActorFitnessDashboard)?.props
    ).toMatchObject({ earliestActivityTime: null })
  })

  // The default range is year to date and the viewer can choose any other, so
  // a fixed span in the description would contradict the page below it.
  it('describes the empty state without a fixed span', async () => {
    const database = createDatabase()
    database.getActorHasFitnessData.mockResolvedValue(false)
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    const header = findElementByType(element, PageHeader)?.props as
      { title: string; description: string } | undefined
    expect(header?.title).toBe('Overview')
    expect(header?.description).not.toMatch(/12 months/i)
  })

  // The dates are the viewer's local days, which the server cannot know, so
  // the header carries empty slots the dashboard fills on wide containers.
  it('gives the dashboard the header slots for the dates and the range picker', async () => {
    const database = createDatabase()
    mockGetDatabase.mockReturnValue(database)

    const element = await Page({ searchParams: Promise.resolve({}) })

    const header = findElementByType(element, PageHeader)?.props as
      | { title: string; description: ReactElement; actions: ReactElement }
      | undefined
    expect(header?.title).toBe('Overview')
    expect(header?.description.type).toBe(OverviewHeaderSlot)
    expect(header?.description.props).toEqual({ slot: 'dates' })
    expect(header?.actions.type).toBe(OverviewHeaderSlot)
    expect(header?.actions.props).toEqual({ slot: 'range' })
  })
})
