import { enableFetchMocks } from 'jest-fetch-mock'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { createRelayAnnounceJob } from '@/lib/jobs/createRelayAnnounceJob'
import { RELAY_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { Timeline } from '@/lib/services/timelines/types'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'

enableFetchMocks()

const ACTIVITY_STREAM_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public'
const RELAY_ACTOR = 'https://relay.example/actor'
const REMOTE_NOTE = 'https://somewhere.test/statuses/relayed-note'

const announceOf = (objectId: string, id = `${RELAY_ACTOR}/announce/1`) => ({
  '@context': 'https://www.w3.org/ns/activitystreams',
  id,
  type: 'Announce',
  actor: RELAY_ACTOR,
  published: '2024-01-01T00:00:00Z',
  object: objectId,
  to: [ACTIVITY_STREAM_PUBLIC],
  cc: []
})

describe('createRelayAnnounceJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('fetches the wrapped note from origin, stores it, and federates it', async () => {
    await createRelayAnnounceJob(database, {
      id: 'job-1',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(REMOTE_NOTE)
    })

    const stored = await database.getStatus({ statusId: REMOTE_NOTE })
    expect(stored).toBeDefined()

    const federated = await database.getTimeline({
      timeline: Timeline.FEDERATED_PUBLIC
    })
    expect(federated.map((status) => status.id)).toContain(REMOTE_NOTE)
  })

  it('does not create a relay-attributed Announce row', async () => {
    await createRelayAnnounceJob(database, {
      id: 'job-2',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(REMOTE_NOTE, `${RELAY_ACTOR}/announce/2`)
    })
    const announce = await database.getStatus({
      statusId: `${RELAY_ACTOR}/announce/2`
    })
    expect(announce).toBeNull()
  })

  it('does not federate a non-public (followers-only) relayed note', async () => {
    const followersOnly = 'https://somewhere.test/statuses/followers-only'
    // Pre-store the note so the job uses the existing status and reaches the
    // public-audience gate without re-fetching.
    await database.createNote({
      id: followersOnly,
      url: followersOnly,
      actorId: 'https://somewhere.test/users/bob',
      text: 'followers only',
      to: ['https://somewhere.test/users/bob/followers'],
      cc: []
    })

    await createRelayAnnounceJob(database, {
      id: 'job-priv',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(followersOnly, `${RELAY_ACTOR}/announce/priv`)
    })

    const federated = await database.getTimeline({
      timeline: Timeline.FEDERATED_PUBLIC
    })
    expect(federated.map((status) => status.id)).not.toContain(followersOnly)
  })

  it('skips our own posts echoed back through the relay (self-echo guard)', async () => {
    const localNote = 'https://test.llun.dev/users/test1/statuses/local-echo'
    await createRelayAnnounceJob(database, {
      id: 'job-3',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(localNote)
    })

    const federated = await database.getTimeline({
      timeline: Timeline.FEDERATED_PUBLIC
    })
    expect(federated.map((status) => status.id)).not.toContain(localNote)
  })

  it('accepts a minimal relay Announce that omits published and cc', async () => {
    const note = 'https://somewhere.test/statuses/relayed-minimal'
    // The shape barkshark/Pleroma relays actually send: no published, no cc.
    await createRelayAnnounceJob(database, {
      id: 'job-min',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${RELAY_ACTOR}/announce/minimal`,
        type: 'Announce',
        actor: RELAY_ACTOR,
        to: [ACTIVITY_STREAM_PUBLIC],
        object: note
      }
    })

    const stored = await database.getStatus({ statusId: note })
    expect(stored).toBeDefined()
    const federated = await database.getTimeline({
      timeline: Timeline.FEDERATED_PUBLIC
    })
    expect(federated.map((status) => status.id)).toContain(note)
  })

  it('is idempotent across repeated relay deliveries of the same note', async () => {
    const note = 'https://somewhere.test/statuses/relayed-dedupe'
    await createRelayAnnounceJob(database, {
      id: 'job-4a',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(note, `${RELAY_ACTOR}/announce/4a`)
    })
    await createRelayAnnounceJob(database, {
      id: 'job-4b',
      name: RELAY_ANNOUNCE_JOB_NAME,
      data: announceOf(note, `${RELAY_ACTOR}/announce/4b`)
    })

    const federated = await database.getTimeline({
      timeline: Timeline.FEDERATED_PUBLIC
    })
    const matches = federated.filter((status) => status.id === note)
    expect(matches).toHaveLength(1)
  })
})
