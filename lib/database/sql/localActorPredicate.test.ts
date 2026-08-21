import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { addStatusToTimelines } from '@/lib/services/timelines'
import { Timeline } from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// "Is this actor local?" asked of the database, in every place that asks it.
//
// The natural spelling — `privateKey IS NOT NULL` — is the wrong test. Actor
// rows written by earlier remote-recording paths carry `privateKey = ''`, an
// empty string rather than NULL, and every one of them is a REMOTE actor. On
// production that is 216 of the 221 rows a null-only check calls local, which
// is why the local public timeline served a majority of remote posts.
//
// The application layer never had this bug: `getActorFromRow` drops
// `privateKey` from the domain object unless it is truthy, so an `Actor` built
// from an empty-string row has no key at all and every JS-side test already
// reads it as remote. Only the SQL predicates disagreed.
//
// One fixture, asserted against every reader, because the invariant is shared
// and a per-module test would restate the same setup five times. The suite runs
// on whichever backend `TEST_DATABASE_TYPE` selects — `NULL <> ''` is unknown
// (and so excluded) on both, but the fixture is what proves it.
describe('local actor predicate', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance(true)

  const DOMAIN = 'llun.test'
  const REMOTE_DOMAIN = 'remote.test'
  const LOCAL_ACTOR_ID = `https://${DOMAIN}/users/genuinely-local`
  // A remote actor recorded with an empty-string key: local to a null-only
  // check, remote to everything else.
  const EMPTY_KEY_ACTOR_ID = `https://${REMOTE_DOMAIN}/users/empty-key`
  // A remote actor recorded the way the current code records one.
  const NULL_KEY_ACTOR_ID = `https://${REMOTE_DOMAIN}/users/null-key`

  const HASHTAG = 'localpredicate'

  const createActor = (
    actorId: string,
    username: string,
    domain: string,
    privateKey: string | undefined
  ) =>
    database.createActor({
      actorId,
      username,
      domain,
      publicKey: `publicKey-${username}`,
      ...(privateKey === undefined ? null : { privateKey }),
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`,
      followersUrl: `${actorId}/followers`,
      createdAt: Date.now()
    })

  const createPublicNote = async (actorId: string, slug: string) => {
    const id = `${actorId}/statuses/${slug}`
    await database.createNote({
      actorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      id,
      text: `Public status #${HASHTAG}`,
      url: id,
      reply: '',
      createdAt: Date.now()
    })
    // Hashtags are stored, not parsed out of the text on insert, so the
    // local/remote scope assertions need the tag row written explicitly.
    await database.createTag({
      statusId: id,
      type: 'hashtag',
      name: `#${HASHTAG}`,
      value: `https://${DOMAIN}/tags/${HASHTAG}`
    })
  }

  beforeAll(async () => {
    await prepare()
    await database.migrate()

    await createActor(
      LOCAL_ACTOR_ID,
      'genuinely-local',
      DOMAIN,
      'privateKey-genuinely-local'
    )
    await createActor(EMPTY_KEY_ACTOR_ID, 'empty-key', REMOTE_DOMAIN, '')
    await createActor(NULL_KEY_ACTOR_ID, 'null-key', REMOTE_DOMAIN, undefined)

    await createPublicNote(LOCAL_ACTOR_ID, 'local-1')
    await createPublicNote(EMPTY_KEY_ACTOR_ID, 'empty-key-1')
    await createPublicNote(NULL_KEY_ACTOR_ID, 'null-key-1')
  }, 30000)

  afterAll(async () => {
    await database.destroy()
  })

  it('stores the empty-string key the fixture depends on', async () => {
    // Guards the fixture itself: if `createActor` ever normalized '' away, the
    // assertions below would all pass while testing nothing.
    const row = await instance('actors')
      .where('id', EMPTY_KEY_ACTOR_ID)
      .first<{ privateKey: string | null }>('privateKey')
    expect(row?.privateKey).toBe('')

    const nullRow = await instance('actors')
      .where('id', NULL_KEY_ACTOR_ID)
      .first<{ privateKey: string | null }>('privateKey')
    expect(nullRow?.privateKey).toBeNull()
  })

  it('excludes an empty-key actor from the local public timeline', async () => {
    const statuses = await database.getTimeline({
      timeline: Timeline.LOCAL_PUBLIC,
      limit: 30
    })
    const actorIds = statuses.map((status) => status.actorId)

    expect(actorIds).toContain(LOCAL_ACTOR_ID)
    expect(actorIds).not.toContain(EMPTY_KEY_ACTOR_ID)
    expect(actorIds).not.toContain(NULL_KEY_ACTOR_ID)
  })

  it('excludes an empty-key actor from the landing page threshold count', async () => {
    // The fixture seeds exactly one genuinely local public post.
    expect(await database.getLocalPublicStatusesCount()).toBe(1)
  })

  it('excludes an empty-key actor from trending status candidates', async () => {
    const candidateIds = await database.getTrendingStatusCandidateIds({
      days: 7
    })

    expect(candidateIds).toContain(`${LOCAL_ACTOR_ID}/statuses/local-1`)
    expect(candidateIds).not.toContain(
      `${EMPTY_KEY_ACTOR_ID}/statuses/empty-key-1`
    )
    expect(candidateIds).not.toContain(
      `${NULL_KEY_ACTOR_ID}/statuses/null-key-1`
    )
  })

  it('treats an empty-key actor as remote in the hashtag local/remote scope', async () => {
    const localIds = (
      await database.getStatusesByHashtag({ hashtag: HASHTAG, local: true })
    ).map((status) => status.id)
    expect(localIds).toEqual([`${LOCAL_ACTOR_ID}/statuses/local-1`])

    const remoteIds = (
      await database.getStatusesByHashtag({ hashtag: HASHTAG, remote: true })
    ).map((status) => status.id)
    expect(remoteIds).toEqual(
      expect.arrayContaining([
        `${EMPTY_KEY_ACTOR_ID}/statuses/empty-key-1`,
        `${NULL_KEY_ACTOR_ID}/statuses/null-key-1`
      ])
    )
    expect(remoteIds).not.toContain(`${LOCAL_ACTOR_ID}/statuses/local-1`)
  })

  it('does not treat an empty-key actor domain as a local domain for followers', async () => {
    // getLocalFollowersForActorId maps "local" to the set of domains that host
    // a local actor. An empty-key actor drags its whole remote domain into that
    // set, so a remote follower on it is returned as a local one.
    await database.createFollow({
      actorId: `https://${REMOTE_DOMAIN}/users/some-follower`,
      targetActorId: LOCAL_ACTOR_ID,
      status: FollowStatus.enum.Accepted,
      inbox: `https://${REMOTE_DOMAIN}/users/some-follower/inbox`,
      sharedInbox: `https://${REMOTE_DOMAIN}/inbox`
    })

    const followers = await database.getLocalFollowersForActorId({
      targetActorId: LOCAL_ACTOR_ID
    })
    expect(followers).toEqual([])
  })

  it('does not fan a status out to an empty-key actor', async () => {
    // addStatusToTimelines materializes home timelines and creates reply /
    // mention notifications for each "local" recipient. A remote actor counted
    // as local gets timeline rows nobody will ever read, and notifications on
    // an account this server does not host.
    //
    // Both halves of the home-timeline rule have to hold for a row to appear:
    // the actor must be a recipient (so it reaches the local-actor filter at
    // all) AND must follow the author (so mainTimelineRule returns MAIN).
    // Without the follow this test passes against the unfixed code, having
    // exercised nothing.
    for (const followerId of [EMPTY_KEY_ACTOR_ID, NULL_KEY_ACTOR_ID]) {
      await database.createFollow({
        actorId: followerId,
        targetActorId: LOCAL_ACTOR_ID,
        status: FollowStatus.enum.Accepted,
        inbox: `${followerId}/inbox`,
        sharedInbox: `https://${REMOTE_DOMAIN}/inbox`
      })
    }

    const status = await database.createNote({
      actorId: LOCAL_ACTOR_ID,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [EMPTY_KEY_ACTOR_ID, NULL_KEY_ACTOR_ID],
      id: `${LOCAL_ACTOR_ID}/statuses/fanout-1`,
      text: 'Mentioning remote actors',
      url: `${LOCAL_ACTOR_ID}/statuses/fanout-1`,
      reply: '',
      createdAt: Date.now()
    })
    await addStatusToTimelines(database, status)

    const fannedOutActorIds = await instance('timelines')
      .where('statusId', `${LOCAL_ACTOR_ID}/statuses/fanout-1`)
      .pluck<string[]>('actorId')

    expect(fannedOutActorIds).not.toContain(EMPTY_KEY_ACTOR_ID)
    expect(fannedOutActorIds).not.toContain(NULL_KEY_ACTOR_ID)
  })
})
