import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getStatusEditHistory } from '@/lib/database/domains/status/history'
import {
  buildReactionRollupContext,
  buildStatusHydrationContext,
  buildViewerHydration,
  collectHydrationStatusIds,
  getStatus,
  getStatusLinkPreviewsForIds,
  getStatusQuoteEdges,
  getStatusWithHydration,
  hydrateStatusRow
} from '@/lib/database/domains/status/hydration'
import {
  getActorStatuses,
  getActorStatusesCount,
  getStatusReblogsCount,
  getStatusReblogsCounts,
  getStatusReplies,
  getStatusRepliesCount,
  getStatusRepliesCounts,
  getStatusesByIds
} from '@/lib/database/domains/status/reads'
import type { StatusRow } from '@/lib/database/domains/status/types'
import { getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { CounterKey } from '@/lib/database/utils/counter'
import {
  type Status,
  type StatusAnnounce,
  type StatusNote,
  type StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getHashFromString } from '@/lib/utils/getHashFromString'

// Query-level tests for the status reads and hydration
// (lib/database/domains/status/reads.ts, hydration.ts and history.ts). Every
// test uses its own actors and statuses (a fresh prefix) and writes
// neighbouring rows next to the ones under test (another actor's statuses,
// another status's attachments, tags, counters, likes and history, another
// viewer's likes and votes), so a dropped predicate returns a wrong row rather
// than happening to return the right one. Rows that tie on a sort key are
// written out of the order the tie-break puts them in, and every timestamp is
// written explicitly, so no expectation depends on two rows created in the same
// millisecond. Runs on PostgreSQL in CI.

const testDb = createTestDatabase()
const db = testDb.db

beforeAll(async () => {
  await testDb.prepare()
  await testDb.database.migrate()
})

afterAll(async () => {
  await testDb.destroy()
})

let prefixCount = 0
const nextPrefix = () => `sr${++prefixCount}`
const DOMAIN = 'reads.test'
const BASE = Date.UTC(2026, 1, 1)
const MINUTE = 60_000
const actorIn = (prefix: string, name: string) =>
  `https://${DOMAIN}/users/${prefix}-${name}`
// Explicit ids for the serial columns whose order a test pins, far above
// what the sequences hand out.
let serialCount = 0
const nextSerial = () => 900_000_000 + ++serialCount * 10

// The statements `run` sends, with what it returned.
const capture = async <T>(run: () => Promise<T>) => {
  let result!: T
  const statements = await testDb.captureQueries(async () => {
    result = await run()
  })
  return { result, statements }
}

const seedActor = async (
  id: string,
  {
    local = false,
    followersUrl = `${id}/followers`
  }: { local?: boolean; followersUrl?: string } = {}
) => {
  let accountId: string | null = null
  if (local) {
    accountId = randomUUID()
    await db
      .insertInto('accounts')
      .values({
        id: accountId,
        email: `${randomUUID()}@${DOMAIN}`,
        passwordHash: 'hash',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
  }
  await db
    .insertInto('actors')
    .values({
      id,
      username: id.split('/').pop() ?? id,
      domain: DOMAIN,
      accountId,
      privateKey: local ? 'private-key' : null,
      publicKey: 'public-key',
      settings: JSON.stringify({
        followersUrl,
        inboxUrl: `${id}/inbox`,
        sharedInboxUrl: `https://${DOMAIN}/inbox`
      }),
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()
  return id
}

type SeedStatus = {
  id: string
  actorId: string
  type?: StatusType
  createdAt?: number | null
  updatedAt?: number | null
  to?: string[]
  cc?: string[]
  reply?: string | null
  replyHash?: string | null
  content?: Record<string, unknown> | string | null
  url?: string
  originalStatusId?: string | null
  publicId?: string | null
  applicationName?: string | null
  applicationWebsite?: string | null
}

const seedStatus = async ({
  id,
  actorId,
  type = StatusType.enum.Note,
  createdAt = BASE,
  updatedAt = createdAt,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  reply = '',
  replyHash = reply ? getHashFromString(reply) : null,
  content = type === StatusType.enum.Announce ? null : { text: `<p>${id}</p>` },
  url = id,
  originalStatusId = null,
  publicId = null,
  applicationName = null,
  applicationWebsite = null
}: SeedStatus) => {
  await db
    .insertInto('statuses')
    .values({
      id,
      url,
      urlHash: getHashFromString(url),
      actorId,
      type,
      reply,
      replyHash,
      content:
        content === null || typeof content === 'string'
          ? content
          : JSON.stringify(content),
      originalStatusId,
      publicId,
      applicationName,
      applicationWebsite,
      createdAt: createdAt === null ? null : new Date(createdAt),
      updatedAt: updatedAt === null ? null : new Date(updatedAt)
    })
    .execute()
  const recipients = [
    ...to.map((recipient) => ({ actorId: recipient, type: 'to' })),
    ...cc.map((recipient) => ({ actorId: recipient, type: 'cc' }))
  ]
  if (recipients.length > 0) {
    await db
      .insertInto('recipients')
      .values(
        recipients.map((recipient) => ({
          id: randomUUID(),
          statusId: id,
          ...recipient,
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        }))
      )
      .execute()
  }
  return id
}

const setCounter = (id: string, value: number) =>
  db
    .insertInto('counters')
    .values({
      id,
      value,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()

const follow = (actorId: string, targetActorId: string, status = 'Accepted') =>
  db
    .insertInto('follows')
    .values({
      id: randomUUID(),
      actorId,
      actorHost: DOMAIN,
      targetActorId,
      targetActorHost: DOMAIN,
      status,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()

const like = (statusId: string, actorId: string) =>
  db
    .insertInto('likes')
    .values({
      statusId,
      actorId,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()

const bookmark = (statusId: string, actorId: string) =>
  db
    .insertInto('bookmarks')
    .values({
      statusId,
      actorId,
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()

const tag = (
  statusId: string,
  name: string,
  type: 'hashtag' | 'emoji' = 'hashtag'
) =>
  db
    .insertInto('tags')
    .values({
      id: randomUUID(),
      statusId,
      type,
      name,
      value: type === 'emoji' ? `https://${DOMAIN}/emoji.png` : '',
      nameNormalized: name.toLowerCase(),
      createdAt: new Date(BASE),
      updatedAt: new Date(BASE)
    })
    .execute()

const attach = (
  statusId: string,
  actorId: string,
  url: string,
  createdAt = BASE
) =>
  db
    .insertInto('attachments')
    .values({
      id: `${statusId}#${url.split('/').pop()}`,
      statusId,
      actorId,
      url,
      mediaType: 'image/webp',
      type: 'Document',
      width: 20,
      height: 10,
      name: 'alt',
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt)
    })
    .execute()

const ids = (statuses: (Status | null)[]) =>
  statuses.map((status) => status?.id)

describe('getStatus', () => {
  it('reads one row by id, limited to one, and null for an id no row has', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const target = `${author}/statuses/1`
    // Ids that share the target's prefix or extend it.
    await seedStatus({ id: `${author}/statuses/10`, actorId: author })
    await seedStatus({ id: `${author}/statuses/1/`, actorId: author })

    await expect(getStatus(db, { statusId: target })).resolves.toBeNull()

    await seedStatus({ id: target, actorId: author })
    const { result, statements } = await capture(() =>
      getStatus(db, { statusId: target })
    )
    expect(result?.id).toBe(target)
    expect(statements[0].sql).toMatch(
      /^select \* from .statuses. where .id. = /
    )
    expect(statements[0].sql).toMatch(/ limit (\?|\$\d+)$/)
    expect(statements[0].bindings).toEqual([target, 1])
  })

  it('reads an undefined or null id as no status', async () => {
    await expect(
      getStatus(db, { statusId: undefined as unknown as string })
    ).resolves.toBeNull()
    await expect(
      getStatus(db, { statusId: null as unknown as string })
    ).resolves.toBeNull()
  })

  it('getStatusWithHydration uses the context it is given in place of the per-status lookups', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const statusId = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author
    })
    await like(statusId, viewer)
    await bookmark(statusId, viewer)

    // The context says the opposite of the rows, so its use is visible.
    const status = (await getStatusWithHydration(db, {
      statusId,
      currentActorId: viewer,
      hydrationContext: {
        likedStatusIds: new Set(),
        bookmarkedStatusIds: new Set(),
        announcedStatusIds: new Map([[statusId, 'announce-from-context']]),
        detectedLanguages: { [statusId]: 'fr' },
        quoteEdges: new Map(),
        linkPreviews: new Map(),
        reactionRollups: new Map([
          [
            statusId,
            [{ name: '🔥', count: 9, me: true, url: null, static_url: null }]
          ]
        ])
      }
    })) as StatusNote
    expect(status).toMatchObject({
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: 'announce-from-context',
      detectedLanguage: 'fr',
      reactions: [
        { name: '🔥', count: 9, me: true, url: null, static_url: null }
      ]
    })

    // Empty quote-edge and link-preview maps mean "none", not "look it up".
    const rich = await seedRichNote(nextPrefix())
    const quiet = (await getStatusWithHydration(db, {
      statusId: rich.noteId,
      hydrationContext: { quoteEdges: new Map(), linkPreviews: new Map() }
    })) as StatusNote
    expect(quiet).not.toHaveProperty('quote')
    expect(quiet).not.toHaveProperty('linkPreview')

    // Without one it looks each up.
    await expect(
      getStatusWithHydration(db, { statusId, currentActorId: viewer })
    ).resolves.toMatchObject({
      isActorLiked: true,
      isActorBookmarked: true,
      actorAnnounceStatusId: null,
      detectedLanguage: null,
      reactions: []
    })
  })
})

// One Note carrying every hydrated field, next to a neighbouring Note of the
// same author carrying its own copy of each, and statuses replying to both.
const seedRichNote = async (prefix: string) => {
  const author = await seedActor(actorIn(prefix, 'author'), {
    local: true,
    followersUrl: `https://${DOMAIN}/collections/${prefix}-followers`
  })
  const viewer = await seedActor(actorIn(prefix, 'viewer'))
  const other = await seedActor(actorIn(prefix, 'other'))
  const parent = await seedStatus({
    id: `${other}/statuses/parent`,
    actorId: other
  })
  const quoted = await seedStatus({
    id: `${other}/statuses/quoted`,
    actorId: other,
    url: `${other}/@quoted`
  })
  const noteId = `${author}/statuses/note`
  const neighbourId = `${author}/statuses/neighbour`
  await seedStatus({
    id: noteId,
    actorId: author,
    createdAt: BASE + 5 * MINUTE,
    updatedAt: BASE + 6 * MINUTE,
    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [`https://${DOMAIN}/collections/${prefix}-followers`],
    reply: parent,
    content: {
      text: '<p>current</p>',
      summary: 'current cw',
      sensitive: true,
      language: 'en',
      url: `${noteId}/canonical`,
      quoteApprovalPolicy: 'followers'
    },
    publicId: `${prefix}-public-id`,
    applicationName: 'Reads App',
    applicationWebsite: 'https://app.reads.test'
  })
  await seedStatus({
    id: neighbourId,
    actorId: author,
    createdAt: BASE + 4 * MINUTE,
    content: { text: '<p>neighbour</p>' }
  })

  // Replies: two to the note (a Poll newer than a Note) and an Announce row
  // carrying the note as its reply, which is hydrated but left out; one to
  // the neighbour.
  await seedStatus({
    id: `${other}/statuses/reply-note`,
    actorId: other,
    reply: noteId,
    createdAt: BASE + 10 * MINUTE
  })
  await seedStatus({
    id: `${other}/statuses/reply-poll`,
    actorId: other,
    type: StatusType.enum.Poll,
    reply: noteId,
    createdAt: BASE + 20 * MINUTE,
    content: { text: '<p>poll reply</p>', endAt: BASE + 86_400_000 }
  })
  await seedStatus({
    id: `${other}/statuses/reply-announce`,
    actorId: other,
    type: StatusType.enum.Announce,
    reply: noteId,
    originalStatusId: parent,
    createdAt: BASE + 30 * MINUTE
  })
  await seedStatus({
    id: `${other}/statuses/reply-neighbour`,
    actorId: other,
    reply: neighbourId,
    createdAt: BASE + 40 * MINUTE
  })

  // Attachments: the map image is the later one, and is moved first.
  const mediaUrl = (name: string) =>
    `https://${DOMAIN}/api/v1/files/medias/${prefix}-${name}.webp`
  await attach(noteId, author, mediaUrl('photo'), BASE)
  await attach(noteId, author, mediaUrl('map'), BASE + MINUTE)
  await attach(noteId, author, mediaUrl('after'), BASE + 2 * MINUTE)
  await attach(neighbourId, author, mediaUrl('neighbour'), BASE)

  await tag(noteId, '#Reads')
  await tag(neighbourId, '#Neighbour')

  await setCounter(CounterKey.totalLike(noteId), 7)
  await setCounter(CounterKey.totalReblog(noteId), 3)
  await setCounter(CounterKey.totalLike(neighbourId), 100)
  await setCounter(CounterKey.totalReblog(neighbourId), 100)

  // The viewer's like, bookmark and boost of the note; the other actor's of
  // the neighbour.
  await like(noteId, viewer)
  await bookmark(noteId, viewer)
  await like(neighbourId, other)
  await bookmark(neighbourId, other)
  await seedStatus({
    id: `${viewer}/statuses/boost-of-note`,
    actorId: viewer,
    type: StatusType.enum.Announce,
    originalStatusId: noteId,
    createdAt: BASE + 50 * MINUTE
  })
  await seedStatus({
    id: `${other}/statuses/boost-of-neighbour`,
    actorId: other,
    type: StatusType.enum.Announce,
    originalStatusId: neighbourId,
    createdAt: BASE + 50 * MINUTE
  })

  // Reactions: the viewer's first, then the other actor's.
  await db
    .insertInto('status_reactions')
    .values([
      {
        statusId: noteId,
        actorId: viewer,
        name: ':blob:',
        url: `https://${DOMAIN}/blob.png`,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        statusId: noteId,
        actorId: other,
        name: '👍',
        url: null,
        createdAt: new Date(BASE + MINUTE),
        updatedAt: new Date(BASE + MINUTE)
      },
      {
        statusId: neighbourId,
        actorId: viewer,
        name: ':cat:',
        url: null,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()

  // Two superseded revisions of the note, written newest first; one of the
  // neighbour's.
  const historyIds = [nextSerial(), nextSerial(), nextSerial()]
  await db
    .insertInto('status_history')
    .values([
      {
        id: historyIds[1],
        statusId: noteId,
        data: JSON.stringify({ text: '<p>second</p>', summary: 'old cw' }),
        createdAt: new Date(BASE + MINUTE),
        updatedAt: new Date(BASE + 3 * MINUTE)
      },
      {
        id: historyIds[0],
        statusId: noteId,
        data: JSON.stringify({
          text: '<p>first</p>',
          summary: null,
          sensitive: false,
          attachments: [],
          pollOptions: null
        }),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE + MINUTE)
      },
      {
        id: historyIds[2],
        statusId: neighbourId,
        data: JSON.stringify({ text: '<p>neighbour first</p>' }),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()

  await db
    .insertInto('status_detected_languages')
    .values([
      {
        statusId: noteId,
        language: 'ja',
        confidence: 0.9,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        statusId: neighbourId,
        language: 'de',
        confidence: 0.9,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()

  await db
    .insertInto('status_quotes')
    .values([
      {
        statusId: noteId,
        quotedStatusId: quoted,
        state: 'accepted',
        authorizationUri: `${quoted}/authorization`,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        statusId: neighbourId,
        quotedStatusId: parent,
        state: 'pending',
        authorizationUri: null,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()

  const previewUrl = `https://news.test/${prefix}`
  const pendingUrl = `https://news.test/${prefix}/pending`
  await db
    .insertInto('link_previews')
    .values([
      {
        urlHash: getHashFromString(previewUrl),
        url: previewUrl,
        type: 'link',
        title: 'News',
        description: 'A story',
        siteName: 'News Site',
        authorName: 'Reporter',
        authorUrl: 'https://news.test/reporter',
        imageUrl: 'https://news.test/image.png',
        imageWidth: 640,
        imageHeight: 320,
        publishedAt: new Date(BASE),
        fetchStatus: 'completed',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        urlHash: getHashFromString(pendingUrl),
        url: pendingUrl,
        type: 'link',
        title: 'Pending',
        fetchStatus: 'pending',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()
  await db
    .insertInto('status_link_previews')
    .values([
      {
        statusId: noteId,
        urlHash: getHashFromString(previewUrl),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        statusId: neighbourId,
        urlHash: getHashFromString(pendingUrl),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      }
    ])
    .execute()

  // Fitness files: the primary file with the earliest start wins. The others
  // lose on isPrimary, on a soft delete, on a later start, and on a later
  // createdAt at the same start; the neighbour has its own.
  const gearId = `${prefix}-gear`
  const deviceGearId = `${prefix}-device`
  await db
    .insertInto('fitness_gears')
    .values([
      {
        id: gearId,
        actorId: author,
        kind: 'bike',
        name: 'Road bike',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      },
      {
        id: deviceGearId,
        actorId: author,
        kind: 'device',
        name: 'Retired computer',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE),
        deletedAt: new Date(BASE)
      }
    ])
    .execute()
  const fitnessFile = (
    id: string,
    statusId: string,
    values: Record<string, unknown>
  ) => ({
    id: `${prefix}-${id}`,
    actorId: author,
    statusId,
    path: `fitness/${prefix}-${id}.fit`,
    fileName: `${id}.fit`,
    fileType: 'fit',
    mimeType: 'application/vnd.ant.fit',
    bytes: 2048,
    createdAt: new Date(BASE),
    updatedAt: new Date(BASE),
    ...values
  })
  await db
    .insertInto('fitness_files')
    .values([
      fitnessFile('not-primary', noteId, {
        isPrimary: false,
        activityStartTime: new Date(BASE - 10 * MINUTE)
      }),
      fitnessFile('deleted', noteId, {
        isPrimary: true,
        activityStartTime: new Date(BASE - 10 * MINUTE),
        deletedAt: new Date(BASE)
      }),
      // Created first, so only the start time puts the winner ahead of it.
      fitnessFile('later-start', noteId, {
        isPrimary: true,
        activityStartTime: new Date(BASE - 5 * MINUTE),
        createdAt: new Date(BASE - MINUTE)
      }),
      fitnessFile('later-created', noteId, {
        isPrimary: true,
        activityStartTime: new Date(BASE - 8 * MINUTE),
        createdAt: new Date(BASE + MINUTE)
      }),
      fitnessFile('winner', noteId, {
        isPrimary: true,
        activityStartTime: new Date(BASE - 8 * MINUTE),
        description: 'Morning ride',
        hasMapData: true,
        mapError: 'tile fetch failed',
        mapImagePath: `/medias/${prefix}-map.webp`,
        processingStatus: 'completed',
        totalDistanceMeters: 12_345.5,
        totalDurationSeconds: 3600,
        movingTimeSeconds: 3300,
        elevationGainMeters: 120.5,
        activityType: 'cycling',
        deviceManufacturer: 'garmin',
        deviceName: 'Edge 540',
        sourceUrl: 'https://strava.test/activities/1',
        gearId,
        deviceGearId,
        avgPower: 210,
        maxPower: 640,
        avgHeartRate: 141,
        maxHeartRate: 182,
        totalWorkKj: 750,
        elevationSeries: JSON.stringify([10, 12.5, 25])
      }),
      fitnessFile('neighbour', neighbourId, {
        isPrimary: true,
        activityStartTime: new Date(BASE - 20 * MINUTE)
      })
    ])
    .execute()

  return {
    author,
    viewer,
    other,
    parent,
    quoted,
    noteId,
    neighbourId,
    previewUrl,
    gearId,
    deviceGearId,
    mediaUrl,
    winnerId: `${prefix}-winner`
  }
}

describe('hydrateStatusRow', () => {
  it('hydrates every field of a Note, alike with and without a batched context', async () => {
    const prefix = nextPrefix()
    const seed = await seedRichNote(prefix)
    const row = (await db
      .selectFrom('statuses')
      .selectAll()
      .where('id', '=', seed.noteId)
      .executeTakeFirstOrThrow()) as StatusRow

    const unbatched = (await hydrateStatusRow(
      db,
      row,
      seed.viewer,
      true
    )) as StatusNote

    expect(unbatched).toEqual({
      id: seed.noteId,
      publicId: `${prefix}-public-id`,
      url: `${seed.noteId}/canonical`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`https://${DOMAIN}/collections/${prefix}-followers`],
      actorId: seed.author,
      actor: expect.objectContaining({
        id: seed.author,
        username: `${prefix}-author`,
        domain: DOMAIN,
        followersUrl: `https://${DOMAIN}/collections/${prefix}-followers`,
        inboxUrl: `${seed.author}/inbox`,
        sharedInboxUrl: `https://${DOMAIN}/inbox`,
        lastStatusAt: null
      }),
      type: StatusType.enum.Note,
      text: '<p>current</p>',
      summary: 'current cw',
      sensitive: true,
      language: 'en',
      detectedLanguage: 'ja',
      applicationName: 'Reads App',
      applicationWebsite: 'https://app.reads.test',
      reply: seed.parent,
      replies: [
        expect.objectContaining({
          id: `${seed.other}/statuses/reply-poll`,
          type: StatusType.enum.Poll
        }),
        expect.objectContaining({
          id: `${seed.other}/statuses/reply-note`,
          type: StatusType.enum.Note
        })
      ],
      quote: {
        quotedStatusId: seed.quoted,
        quotedStatusUrl: `${seed.other}/@quoted`,
        state: 'accepted',
        authorizationUri: `${seed.quoted}/authorization`
      },
      linkPreview: {
        url: seed.previewUrl,
        title: 'News',
        description: 'A story',
        type: 'link',
        siteName: 'News Site',
        authorName: 'Reporter',
        authorUrl: 'https://news.test/reporter',
        imageUrl: 'https://news.test/image.png',
        imageWidth: 640,
        imageHeight: 320,
        publishedAt: BASE
      },
      quoteApprovalPolicy: 'followers',
      totalLikes: 7,
      totalShares: 3,
      reactions: [
        {
          name: ':blob:',
          count: 1,
          me: true,
          url: `https://${DOMAIN}/blob.png`,
          static_url: `https://${DOMAIN}/blob.png`
        },
        { name: '👍', count: 1, me: false, url: null, static_url: null }
      ],
      isActorLiked: true,
      isActorBookmarked: true,
      actorAnnounceStatusId: `${seed.viewer}/statuses/boost-of-note`,
      isLocalActor: true,
      attachments: [
        expect.objectContaining({
          id: `${seed.noteId}#${prefix}-map.webp`,
          url: seed.mediaUrl('map')
        }),
        expect.objectContaining({
          id: `${seed.noteId}#${prefix}-photo.webp`,
          url: seed.mediaUrl('photo')
        }),
        expect.objectContaining({
          id: `${seed.noteId}#${prefix}-after.webp`,
          url: seed.mediaUrl('after')
        })
      ],
      tags: [
        expect.objectContaining({
          statusId: seed.noteId,
          type: 'hashtag',
          name: '#Reads'
        })
      ],
      fitness: {
        id: seed.winnerId,
        fileName: 'winner.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 2048,
        url: `/api/v1/fitness-files/${seed.winnerId}`,
        processingStatus: 'completed',
        processingStuck: false,
        mapFailure: 'stale',
        totalDistanceMeters: 12_345.5,
        totalDurationSeconds: 3600,
        movingTimeSeconds: 3300,
        elevationGainMeters: 120.5,
        activityType: 'cycling',
        activityStartTime: BASE - 8 * MINUTE,
        hasMapData: true,
        description: 'Morning ride',
        deviceManufacturer: 'garmin',
        deviceName: 'Edge 540',
        sourceUrl: 'https://strava.test/activities/1',
        gearId: seed.gearId,
        gearName: 'Road bike',
        // The device gear is soft-deleted: its id stays, its name does not.
        deviceGearId: seed.deviceGearId,
        deviceGearName: null,
        avgPower: 210,
        maxPower: 640,
        avgHeartRate: 141,
        maxHeartRate: 182,
        totalWorkKj: 750,
        elevationSeries: [10, 12.5, 25]
      },
      createdAt: BASE + 5 * MINUTE,
      updatedAt: BASE + 6 * MINUTE,
      edits: [
        expect.objectContaining({
          text: '<p>first</p>',
          textAvailable: true,
          summary: null,
          createdAt: BASE
        }),
        expect.objectContaining({
          text: '<p>second</p>',
          textAvailable: true,
          summary: 'old cw',
          createdAt: BASE + MINUTE
        })
      ]
    })

    // The page path: the same status, from one batched context.
    const [batched] = await getStatusesByIds(db, {
      statusIds: [seed.noteId],
      currentActorId: seed.viewer,
      withReplies: true
    })
    expect(batched).toEqual(unbatched)

    // The neighbour carries only its own rows.
    const neighbour = (await getStatus(db, {
      statusId: seed.neighbourId,
      currentActorId: seed.viewer,
      withReplies: true
    })) as StatusNote
    expect(neighbour).toMatchObject({
      totalLikes: 100,
      totalShares: 100,
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      detectedLanguage: 'de',
      quote: { quotedStatusId: seed.parent, state: 'pending' },
      reactions: [
        { name: ':cat:', count: 1, me: true, url: null, static_url: null }
      ],
      replies: [
        expect.objectContaining({
          id: `${seed.other}/statuses/reply-neighbour`
        })
      ],
      fitness: expect.objectContaining({ id: `${prefix}-neighbour` }),
      edits: [expect.objectContaining({ text: '<p>neighbour first</p>' })]
    })
    expect(neighbour.linkPreview).toBeUndefined()
    // Its fitness file has no map error, so no map failure is reported.
    expect(neighbour.fitness).not.toHaveProperty('mapFailure')
    expect(neighbour.attachments.map((item) => item.url)).toEqual([
      seed.mediaUrl('neighbour')
    ])
    expect(neighbour.tags.map((item) => item.name)).toEqual(['#Neighbour'])
  })

  it('leaves out the viewer state and replies when there is no viewer or withReplies', async () => {
    const prefix = nextPrefix()
    const seed = await seedRichNote(prefix)
    const status = (await getStatus(db, {
      statusId: seed.noteId
    })) as StatusNote
    expect(status).toMatchObject({
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      replies: [],
      reactions: [
        expect.objectContaining({ name: ':blob:', me: false }),
        expect.objectContaining({ name: '👍', me: false })
      ]
    })

    // Another viewer sees none of the viewer's state.
    const other = (await getStatus(db, {
      statusId: seed.noteId,
      currentActorId: seed.other
    })) as StatusNote
    expect(other).toMatchObject({
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      reactions: [
        expect.objectContaining({ name: ':blob:', me: false }),
        expect.objectContaining({ name: '👍', me: true })
      ]
    })
  })

  it('hydrates a Note with nothing attached to its defaults', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author,
      to: [],
      content: { text: '<p>bare</p>' }
    })
    await expect(getStatus(db, { statusId })).resolves.toEqual({
      id: statusId,
      publicId: null,
      url: statusId,
      to: [],
      cc: [],
      actorId: author,
      actor: expect.objectContaining({ id: author }),
      type: StatusType.enum.Note,
      text: '<p>bare</p>',
      sensitive: false,
      language: null,
      detectedLanguage: null,
      applicationName: null,
      applicationWebsite: null,
      reply: '',
      replies: [],
      totalLikes: 0,
      totalShares: 0,
      reactions: [],
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      isLocalActor: false,
      attachments: [],
      tags: [],
      createdAt: BASE,
      updatedAt: BASE,
      edits: []
    })
  })

  it('leaves the attachments in order when there is no map image to put first', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const urlOf = (name: string) => `https://${DOMAIN}/${prefix}/${name}`
    // No fitness file: a path ending in "undefined" is not a map image.
    const bare = await seedStatus({
      id: `${author}/statuses/bare`,
      actorId: author
    })
    await attach(bare, author, urlOf('first.webp'), BASE)
    await attach(bare, author, urlOf('undefined'), BASE + MINUTE)
    // A fitness file with a NULL map image: nor is one ending in "null".
    const noMap = await seedStatus({
      id: `${author}/statuses/no-map`,
      actorId: author
    })
    await db
      .insertInto('fitness_files')
      .values({
        id: `${prefix}-file`,
        actorId: author,
        statusId: noMap,
        path: 'fitness/file.fit',
        fileName: 'file.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1,
        mapImagePath: null,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    await attach(noMap, author, urlOf('first.webp'), BASE)
    await attach(noMap, author, urlOf('null'), BASE + MINUTE)

    for (const [statusId, last] of [
      [bare, 'undefined'],
      [noMap, 'null']
    ]) {
      const status = (await getStatus(db, { statusId })) as StatusNote
      expect(status.attachments.map((item) => item.url)).toEqual([
        urlOf('first.webp'),
        urlOf(last)
      ])
    }
  })

  it('picks the earliest created of the fitness files that tie on start, whichever was written first', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const file = (id: string, statusId: string, createdAt: number) => ({
      id: `${prefix}-${id}`,
      actorId: author,
      statusId,
      path: `fitness/${prefix}-${id}.fit`,
      fileName: `${id}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1,
      isPrimary: true,
      activityStartTime: new Date(BASE),
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt)
    })
    // The winner is written first for one status and second for the other, so
    // a read that dropped the createdAt tie-break returns the wrong file for
    // at least one of them whichever way the sort breaks the tie.
    const winnerFirst = await seedStatus({
      id: `${author}/statuses/winner-first`,
      actorId: author
    })
    const winnerSecond = await seedStatus({
      id: `${author}/statuses/winner-second`,
      actorId: author
    })
    await db
      .insertInto('fitness_files')
      .values([
        file('first-winner', winnerFirst, BASE),
        file('first-later', winnerFirst, BASE + MINUTE),
        file('second-later', winnerSecond, BASE + MINUTE),
        file('second-winner', winnerSecond, BASE)
      ])
      .execute()

    for (const [statusId, winner] of [
      [winnerFirst, 'first-winner'],
      [winnerSecond, 'second-winner']
    ]) {
      const status = (await getStatus(db, { statusId })) as StatusNote
      expect(status.fitness?.id).toBe(`${prefix}-${winner}`)
    }
  })

  it('keeps a fitness file whose gear is soft-deleted, and reports a stuck or failed one', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author
    })
    await db
      .insertInto('fitness_gears')
      .values({
        id: `${prefix}-gear`,
        actorId: author,
        kind: 'bike',
        name: 'Sold bike',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE),
        deletedAt: new Date(BASE)
      })
      .execute()
    await db
      .insertInto('fitness_files')
      .values({
        id: `${prefix}-file`,
        actorId: author,
        statusId,
        path: 'fitness/file.fit',
        fileName: 'file.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1,
        gearId: `${prefix}-gear`,
        processingStatus: 'processing',
        hasMapData: false,
        mapError: 'no points',
        // A map image no attachment matches leaves their order alone.
        mapImagePath: `/medias/${prefix}-none.webp`,
        // An epoch-0 start reads as unset on both backends.
        activityStartTime: new Date(0),
        createdAt: new Date(BASE),
        // Long enough ago that the worker must have died.
        updatedAt: new Date(BASE)
      })
      .execute()
    await attach(statusId, author, `https://${DOMAIN}/${prefix}-a.webp`, BASE)
    await attach(
      statusId,
      author,
      `https://${DOMAIN}/${prefix}-b.webp`,
      BASE + MINUTE
    )
    const status = (await getStatus(db, { statusId })) as StatusNote
    expect(status.attachments.map((item) => item.url)).toEqual([
      `https://${DOMAIN}/${prefix}-a.webp`,
      `https://${DOMAIN}/${prefix}-b.webp`
    ])
    expect(status.fitness).toEqual({
      id: `${prefix}-file`,
      fileName: 'file.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1,
      url: `/api/v1/fitness-files/${prefix}-file`,
      processingStatus: 'processing',
      processingStuck: true,
      mapFailure: 'missing',
      hasMapData: false,
      gearId: `${prefix}-gear`,
      gearName: null,
      deviceGearId: null,
      deviceGearName: null
    })
  })

  it('hydrates every field of a Poll, with the viewer’s votes', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const pollId = await seedStatus({
      id: `${author}/statuses/poll`,
      actorId: author,
      type: StatusType.enum.Poll,
      createdAt: BASE + MINUTE,
      content: {
        text: '<p>which?</p>',
        endAt: BASE + 86_400_000,
        pollType: 'anyOf',
        hideTotals: true
      }
    })
    const neighbourId = await seedStatus({
      id: `${author}/statuses/neighbour`,
      actorId: author,
      type: StatusType.enum.Poll,
      content: { text: '<p>neighbour</p>', endAt: BASE + 86_400_000 }
    })
    // Choices written out of choiceId order.
    const [first, second, third] = [nextSerial(), nextSerial(), nextSerial()]
    await db
      .insertInto('poll_choices')
      .values(
        [
          { choiceId: third, statusId: pollId, title: 'C', totalVotes: 0 },
          { choiceId: first, statusId: pollId, title: 'A', totalVotes: 2 },
          { choiceId: second, statusId: pollId, title: 'B', totalVotes: 1 },
          {
            choiceId: nextSerial(),
            statusId: neighbourId,
            title: 'N',
            totalVotes: 5
          }
        ].map((choice) => ({
          ...choice,
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        }))
      )
      .execute()
    const vote = async (statusId: string, actorId: string, choice: number) => {
      await db.insertInto('poll_voters').values({ statusId, actorId }).execute()
      await db
        .insertInto('poll_answers')
        .values({ statusId, actorId, choice })
        .execute()
    }
    await vote(pollId, viewer, 0)
    await vote(pollId, other, 1)
    await vote(neighbourId, viewer, 0)
    await vote(neighbourId, `${other}-2`, 0)
    await vote(neighbourId, `${other}-3`, 0)
    await db
      .insertInto('status_history')
      .values({
        statusId: pollId,
        data: JSON.stringify({
          text: '<p>which?</p>',
          pollOptions: ['A', 'B']
        }),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE + MINUTE)
      })
      .execute()

    const poll = (await getStatus(db, {
      statusId: pollId,
      currentActorId: viewer
    })) as StatusPoll
    expect(poll).toEqual({
      id: pollId,
      publicId: null,
      url: pollId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      actorId: author,
      actor: expect.objectContaining({ id: author }),
      type: StatusType.enum.Poll,
      text: '<p>which?</p>',
      sensitive: false,
      language: null,
      detectedLanguage: null,
      applicationName: null,
      applicationWebsite: null,
      reply: '',
      replies: [],
      totalLikes: 0,
      totalShares: 0,
      reactions: [],
      isActorLiked: false,
      isActorBookmarked: false,
      actorAnnounceStatusId: null,
      isLocalActor: false,
      attachments: [],
      tags: [],
      createdAt: BASE + MINUTE,
      updatedAt: BASE + MINUTE,
      edits: [
        expect.objectContaining({
          text: '<p>which?</p>',
          textAvailable: true,
          createdAt: BASE
        })
      ],
      choices: [
        expect.objectContaining({
          statusId: pollId,
          title: 'A',
          totalVotes: 2
        }),
        expect.objectContaining({
          statusId: pollId,
          title: 'B',
          totalVotes: 1
        }),
        expect.objectContaining({ statusId: pollId, title: 'C', totalVotes: 0 })
      ],
      endAt: BASE + 86_400_000,
      pollType: 'anyOf',
      hideTotals: true,
      votersCount: 2,
      voted: true,
      ownVotes: [0]
    })
    // The edit records the third option as added.
    expect(poll.edits[0]).toMatchObject({
      changes: expect.arrayContaining(['poll-options-changed'])
    })

    await expect(
      getStatus(db, { statusId: pollId, currentActorId: other })
    ).resolves.toMatchObject({ voted: true, ownVotes: [1], votersCount: 2 })
    await expect(getStatus(db, { statusId: pollId })).resolves.toMatchObject({
      voted: false,
      ownVotes: [],
      votersCount: 2
    })
    await expect(
      getStatus(db, { statusId: neighbourId, currentActorId: other })
    ).resolves.toMatchObject({
      choices: [expect.objectContaining({ title: 'N' })],
      votersCount: 3,
      voted: false,
      ownVotes: [],
      pollType: 'oneOf',
      hideTotals: false
    })
  })

  it('falls back to the creation time for a poll end that is not a time', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const pollId = await seedStatus({
      id: `${author}/statuses/poll`,
      actorId: author,
      type: StatusType.enum.Poll,
      createdAt: BASE + 7 * MINUTE,
      content: { text: '<p>?</p>', endAt: 'soon' }
    })
    await expect(getStatus(db, { statusId: pollId })).resolves.toMatchObject({
      endAt: BASE + 7 * MINUTE,
      choices: [],
      votersCount: 0
    })
  })

  it('hydrates an Announce of a Note with the Note as the viewer sees it', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const booster = await seedActor(actorIn(prefix, 'booster'), { local: true })
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const noteId = await seedStatus({
      id: `${author}/statuses/note`,
      actorId: author
    })
    await like(noteId, viewer)
    await setCounter(CounterKey.totalReblog(noteId), 2)
    const announceId = await seedStatus({
      id: `${booster}/statuses/boost`,
      actorId: booster,
      type: StatusType.enum.Announce,
      originalStatusId: noteId,
      createdAt: BASE + MINUTE,
      updatedAt: BASE + 2 * MINUTE,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${booster}/followers`],
      publicId: `${prefix}-boost`
    })
    // The Announce's own counters, likes and attachments are not read.
    await setCounter(CounterKey.totalLike(announceId), 50)
    await like(announceId, viewer)

    const original = await getStatus(db, {
      statusId: noteId,
      currentActorId: viewer
    })
    const announce = (await getStatus(db, {
      statusId: announceId,
      currentActorId: viewer
    })) as StatusAnnounce
    expect(announce).toEqual({
      id: announceId,
      publicId: `${prefix}-boost`,
      actorId: booster,
      actor: expect.objectContaining({ id: booster }),
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${booster}/followers`],
      edits: [],
      originalStatus: original,
      isLocalActor: true,
      createdAt: BASE + MINUTE,
      updatedAt: BASE + 2 * MINUTE
    })
    expect(announce.originalStatus).toMatchObject({
      id: noteId,
      isActorLiked: true,
      totalShares: 2
    })

    // A legacy row names the original in its content; the batched page path
    // hydrates it the same way.
    const legacyId = await seedStatus({
      id: `${booster}/statuses/legacy-boost`,
      actorId: booster,
      type: StatusType.enum.Announce,
      content: noteId,
      createdAt: BASE + MINUTE,
      updatedAt: BASE + 2 * MINUTE,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${booster}/followers`],
      publicId: `${prefix}-legacy`
    })
    const [legacy, again] = await getStatusesByIds(db, {
      statusIds: [legacyId, announceId],
      currentActorId: viewer
    })
    expect(legacy).toEqual({
      ...announce,
      id: legacyId,
      publicId: `${prefix}-legacy`
    })
    expect(again).toEqual(announce)
  })

  it('hydrates an Announce of a Poll with the viewer’s vote', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const booster = await seedActor(actorIn(prefix, 'booster'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const pollId = await seedStatus({
      id: `${author}/statuses/poll`,
      actorId: author,
      type: StatusType.enum.Poll,
      content: { text: '<p>?</p>', endAt: BASE + 86_400_000 }
    })
    await db
      .insertInto('poll_choices')
      .values([
        { statusId: pollId, title: 'yes', totalVotes: 1 },
        { statusId: pollId, title: 'no', totalVotes: 0 }
      ])
      .execute()
    await db
      .insertInto('poll_voters')
      .values({ statusId: pollId, actorId: viewer })
      .execute()
    await db
      .insertInto('poll_answers')
      .values({ statusId: pollId, actorId: viewer, choice: 0 })
      .execute()
    const announceId = await seedStatus({
      id: `${booster}/statuses/boost`,
      actorId: booster,
      type: StatusType.enum.Announce,
      originalStatusId: pollId,
      createdAt: BASE + MINUTE
    })

    const announce = (await getStatus(db, {
      statusId: announceId,
      currentActorId: viewer
    })) as StatusAnnounce
    expect(announce).toEqual({
      id: announceId,
      publicId: null,
      actorId: booster,
      actor: expect.objectContaining({ id: booster }),
      type: StatusType.enum.Announce,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      edits: [],
      originalStatus: await getStatus(db, {
        statusId: pollId,
        currentActorId: viewer
      }),
      isLocalActor: false,
      createdAt: BASE + MINUTE,
      updatedAt: BASE + MINUTE
    })
    expect(announce.originalStatus).toMatchObject({
      type: StatusType.enum.Poll,
      choices: [
        expect.objectContaining({ title: 'yes' }),
        expect.objectContaining({ title: 'no' })
      ],
      votersCount: 1,
      voted: true,
      ownVotes: [0]
    })
    const [batched] = await getStatusesByIds(db, {
      statusIds: [announceId],
      currentActorId: viewer
    })
    expect(batched).toEqual(announce)
  })

  it('reads an Announce whose original is gone, or that points nowhere, as no status', async () => {
    const prefix = nextPrefix()
    const booster = await seedActor(actorIn(prefix, 'booster'))
    const missing = await seedStatus({
      id: `${booster}/statuses/missing`,
      actorId: booster,
      type: StatusType.enum.Announce,
      originalStatusId: `${booster}/statuses/gone`
    })
    const nowhere = await seedStatus({
      id: `${booster}/statuses/nowhere`,
      actorId: booster,
      type: StatusType.enum.Announce
    })
    await expect(getStatus(db, { statusId: missing })).resolves.toBeNull()
    await expect(getStatus(db, { statusId: nowhere })).resolves.toBeNull()
    await expect(
      getStatusesByIds(db, { statusIds: [missing, nowhere] })
    ).resolves.toEqual([])
  })
})

describe('getStatusEditHistory', () => {
  it('reads one status’s revisions by when they were superseded, then by id', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author
    })
    const neighbourId = await seedStatus({
      id: `${author}/statuses/2`,
      actorId: author
    })
    // The latest one has the lowest id, so an id order alone would put it
    // first.
    const [latest, low, high, neighbour] = [
      nextSerial(),
      nextSerial(),
      nextSerial(),
      nextSerial()
    ]
    // The two that tie on updatedAt are written higher id first, and the
    // latest one first of all.
    await db
      .insertInto('status_history')
      .values([
        {
          id: latest,
          statusId,
          data: JSON.stringify({ text: 'latest' }),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE + 2 * MINUTE)
        },
        {
          id: high,
          statusId,
          data: JSON.stringify({ text: 'high' }),
          createdAt: new Date(BASE + 3 * MINUTE),
          updatedAt: new Date(BASE + MINUTE)
        },
        {
          id: low,
          statusId,
          data: JSON.stringify({ text: 'low' }),
          createdAt: new Date(BASE + 3 * MINUTE),
          updatedAt: new Date(BASE + MINUTE)
        },
        {
          id: neighbour,
          statusId: neighbourId,
          data: JSON.stringify({ text: 'neighbour' }),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        }
      ])
      .execute()

    const revisions = await getStatusEditHistory(db, { statusId })
    expect(revisions.map((revision) => revision.text)).toEqual([
      'low',
      'high',
      'latest'
    ])
    expect(revisions.map((revision) => revision.supersededAt)).toEqual([
      BASE + MINUTE,
      BASE + MINUTE,
      BASE + 2 * MINUTE
    ])
    expect(revisions.map((revision) => revision.createdAt)).toEqual([
      BASE + 3 * MINUTE,
      BASE + 3 * MINUTE,
      BASE
    ])
    await expect(
      getStatusEditHistory(db, { statusId: `${author}/statuses/3` })
    ).resolves.toEqual([])
  })

  it('reports which fields each revision recorded', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = await seedStatus({
      id: `${author}/statuses/1`,
      actorId: author
    })
    const attachment = {
      id: 'attachment-1',
      actorId: author,
      statusId,
      type: 'Document',
      mediaType: 'image/png',
      url: `https://${DOMAIN}/media.png`,
      width: 1,
      height: 1,
      name: '',
      createdAt: BASE,
      updatedAt: BASE
    }
    const revisions = [
      {
        text: 'full',
        summary: null,
        sensitive: true,
        attachments: [attachment],
        pollOptions: ['a', 'b']
      },
      { text: 'legacy', summary: 'cw' },
      {
        text: 'broken',
        attachments: [{ broken: true }],
        pollOptions: ['a', 1]
      },
      null
    ]
    await db
      .insertInto('status_history')
      .values(
        revisions.map((data, index) => ({
          statusId,
          data: data === null ? null : JSON.stringify(data),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE + index * MINUTE)
        }))
      )
      .execute()

    await expect(getStatusEditHistory(db, { statusId })).resolves.toEqual([
      {
        text: 'full',
        summary: null,
        sensitive: true,
        attachments: [attachment],
        pollOptions: ['a', 'b'],
        createdAt: BASE,
        available: {
          text: true,
          summary: true,
          sensitive: true,
          attachments: true,
          pollOptions: true
        },
        supersededAt: BASE
      },
      {
        text: 'legacy',
        summary: 'cw',
        sensitive: null,
        attachments: null,
        pollOptions: null,
        createdAt: BASE,
        available: {
          text: true,
          summary: true,
          sensitive: false,
          attachments: false,
          pollOptions: false
        },
        supersededAt: BASE + MINUTE
      },
      {
        text: 'broken',
        summary: null,
        sensitive: null,
        attachments: null,
        pollOptions: ['a'],
        createdAt: BASE,
        available: {
          text: true,
          summary: false,
          sensitive: false,
          attachments: false,
          pollOptions: false
        },
        supersededAt: BASE + 2 * MINUTE
      },
      {
        text: '',
        summary: null,
        sensitive: null,
        attachments: null,
        pollOptions: null,
        createdAt: BASE,
        available: {
          text: false,
          summary: false,
          sensitive: false,
          attachments: false,
          pollOptions: false
        },
        supersededAt: BASE + 3 * MINUTE
      }
    ])
  })

  it('reads an undefined status id as no revisions', async () => {
    await expect(
      getStatusEditHistory(db, { statusId: undefined as unknown as string })
    ).resolves.toEqual([])
  })

  it.runIf(testDb.backend === 'sqlite')(
    'decodes a revision whose data is a JSON-encoded string twice on SQLite, as PostgreSQL always has',
    async () => {
      const prefix = nextPrefix()
      const author = await seedActor(actorIn(prefix, 'author'))
      const statusId = await seedStatus({
        id: `${author}/statuses/1`,
        actorId: author
      })
      // The text the column holds is itself a JSON string. The driver parses
      // the json column to that string and getCompatibleJSON parses it again,
      // so the revision reads with its fields, not as an empty one.
      await db
        .insertInto('status_history')
        .values({
          statusId,
          data: JSON.stringify(
            JSON.stringify({ text: 'inner', summary: null })
          ),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        })
        .execute()

      await expect(getStatusEditHistory(db, { statusId })).resolves.toEqual([
        {
          text: 'inner',
          summary: null,
          sensitive: null,
          attachments: null,
          pollOptions: null,
          createdAt: BASE,
          available: {
            text: true,
            summary: true,
            sensitive: false,
            attachments: false,
            pollOptions: false
          },
          supersededAt: BASE
        }
      ])
    }
  )
})

describe('getStatusReplies', () => {
  // A parent whose url differs from its id, with replies by id and by url
  // whose ids sort against their creation order (the oldest is z1), two of
  // them tied on createdAt and written in descending id order.
  const seedReplies = async (prefix: string) => {
    const author = await seedActor(actorIn(prefix, 'author'))
    const replier = await seedActor(actorIn(prefix, 'replier'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const parent = await seedStatus({
      id: `${author}/statuses/parent`,
      actorId: author,
      url: `${author}/@parent`
    })
    const sibling = await seedStatus({
      id: `${author}/statuses/sibling`,
      actorId: author
    })
    const reply = (name: string, values: Partial<SeedStatus>) =>
      seedStatus({
        id: `${replier}/statuses/${name}`,
        actorId: replier,
        ...values
      })
    await reply('c3', { reply: parent, createdAt: BASE + 2 * MINUTE })
    await reply('b2', {
      reply: `${author}/@parent`,
      createdAt: BASE + 2 * MINUTE
    })
    await reply('z1', { reply: parent, createdAt: BASE + MINUTE })
    await reply('a4-followers', {
      reply: parent,
      createdAt: BASE + 3 * MINUTE,
      to: [`${replier}/followers`]
    })
    await reply('05-to-viewer', {
      reply: parent,
      createdAt: BASE + 4 * MINUTE,
      to: [viewer]
    })
    await reply('06-sibling', { reply: sibling, createdAt: BASE + 5 * MINUTE })
    return { author, replier, viewer, parent, url: `${author}/@parent` }
  }

  it('reads the replies by id, and by url when one is given, newest first then by id', async () => {
    const prefix = nextPrefix()
    const seed = await seedReplies(prefix)
    const replyId = (name: string) => `${seed.replier}/statuses/${name}`

    await expect(
      getStatusReplies(db, { statusId: seed.parent }).then(ids)
    ).resolves.toEqual([
      replyId('05-to-viewer'),
      replyId('a4-followers'),
      replyId('c3'),
      replyId('z1')
    ])
    await expect(
      getStatusReplies(db, { statusId: seed.parent, url: seed.url }).then(ids)
    ).resolves.toEqual([
      replyId('05-to-viewer'),
      replyId('a4-followers'),
      replyId('c3'),
      replyId('b2'),
      replyId('z1')
    ])
    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        url: seed.url,
        order: 'asc'
      }).then(ids)
    ).resolves.toEqual([
      replyId('z1'),
      replyId('b2'),
      replyId('c3'),
      replyId('a4-followers'),
      replyId('05-to-viewer')
    ])
  })

  it('limits the page through parseInt, and not at all for 0 or a value that does not parse', async () => {
    const prefix = nextPrefix()
    const seed = await seedReplies(prefix)
    const replyId = (name: string) => `${seed.replier}/statuses/${name}`
    const page = (limit: unknown) =>
      getStatusReplies(db, {
        statusId: seed.parent,
        url: seed.url,
        order: 'asc',
        limit: limit as number
      }).then(ids)

    await expect(page(2)).resolves.toEqual([replyId('z1'), replyId('b2')])
    await expect(page('3')).resolves.toEqual([
      replyId('z1'),
      replyId('b2'),
      replyId('c3')
    ])
    await expect(page(1.9)).resolves.toEqual([replyId('z1')])
    await expect(page('many')).resolves.toHaveLength(5)
    await expect(page(0)).resolves.toHaveLength(5)
  })

  it('filters by public readability, or by what the viewer may read, and hydrates for the current actor', async () => {
    const prefix = nextPrefix()
    const seed = await seedReplies(prefix)
    const replyId = (name: string) => `${seed.replier}/statuses/${name}`
    await like(replyId('c3'), seed.viewer)

    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        url: seed.url,
        publicOnly: true,
        // publicOnly wins over the viewer.
        visibleToActorId: seed.viewer
      }).then(ids)
    ).resolves.toEqual([replyId('c3'), replyId('b2'), replyId('z1')])
    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        url: seed.url,
        visibleToActorId: seed.viewer
      }).then(ids)
    ).resolves.toEqual([
      replyId('05-to-viewer'),
      replyId('c3'),
      replyId('b2'),
      replyId('z1')
    ])
    // The replier reads its own followers-only reply.
    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        visibleToActorId: seed.replier
      }).then(ids)
    ).resolves.toEqual([
      replyId('05-to-viewer'),
      replyId('a4-followers'),
      replyId('c3'),
      replyId('z1')
    ])
    // An accepted follower of the replier reads the followers-only reply; a
    // pending one does not.
    const follower = await seedActor(actorIn(prefix, 'follower'))
    const pending = await seedActor(actorIn(prefix, 'pending'))
    await follow(follower, seed.replier)
    await follow(pending, seed.replier, 'Requested')
    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        visibleToActorId: follower
      }).then(ids)
    ).resolves.toEqual([replyId('a4-followers'), replyId('c3'), replyId('z1')])
    await expect(
      getStatusReplies(db, {
        statusId: seed.parent,
        visibleToActorId: pending
      }).then(ids)
    ).resolves.toEqual([replyId('c3'), replyId('z1')])

    const replies = (await getStatusReplies(db, {
      statusId: seed.parent,
      publicOnly: true,
      currentActorId: seed.viewer
    })) as StatusNote[]
    expect(replies.map((reply) => [reply.id, reply.isActorLiked])).toEqual([
      [replyId('c3'), true],
      [replyId('z1'), false]
    ])
  })

  it('reads an undefined parent id as no replies', async () => {
    await expect(
      getStatusReplies(db, { statusId: undefined as unknown as string })
    ).resolves.toEqual([])
  })
})

describe('getActorStatusesCount', () => {
  it('reads the status counter, or counts the publicly readable statuses', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const other = await seedActor(actorIn(prefix, 'other'))
    await setCounter(CounterKey.totalStatus(author), 42)
    await setCounter(CounterKey.totalStatus(other), 7)

    const publicNote = await seedStatus({
      id: `${other}/statuses/public`,
      actorId: other
    })
    const privateNote = await seedStatus({
      id: `${other}/statuses/private`,
      actorId: other,
      to: [`${other}/followers`]
    })
    await seedStatus({ id: `${author}/statuses/public`, actorId: author })
    await seedStatus({
      id: `${author}/statuses/compact`,
      actorId: author,
      to: [ACTIVITY_STREAM_PUBLIC_COMPACT]
    })
    await seedStatus({
      id: `${author}/statuses/unlisted`,
      actorId: author,
      to: [`${author}/followers`],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await seedStatus({
      id: `${author}/statuses/followers`,
      actorId: author,
      to: [`${author}/followers`]
    })
    await seedStatus({
      id: `${author}/statuses/direct`,
      actorId: author,
      to: [other]
    })
    await seedStatus({
      id: `${author}/statuses/boost-public`,
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: publicNote
    })
    await seedStatus({
      id: `${author}/statuses/boost-private`,
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: privateNote
    })

    await expect(getActorStatusesCount(db, { actorId: author })).resolves.toBe(
      42
    )
    await expect(
      getActorStatusesCount(db, { actorId: author, publicOnly: false })
    ).resolves.toBe(42)
    await expect(
      getActorStatusesCount(db, { actorId: author, publicOnly: true })
    ).resolves.toBe(4)
    await expect(
      getActorStatusesCount(db, { actorId: other, publicOnly: true })
    ).resolves.toBe(1)
    await expect(
      getActorStatusesCount(db, { actorId: `${author}-none` })
    ).resolves.toBe(0)
    await expect(
      getActorStatusesCount(db, { actorId: `${author}-none`, publicOnly: true })
    ).resolves.toBe(0)
  })
})

describe('getActorStatuses', () => {
  it('reads one actor’s statuses newest first, then by id, a page at a time', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    // b and c tie on createdAt and are written c first.
    await seedStatus({ id: statusId('a'), actorId: author, createdAt: BASE })
    await seedStatus({
      id: statusId('c'),
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({
      id: statusId('b'),
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({
      id: statusId('d'),
      actorId: author,
      createdAt: BASE + 2 * MINUTE
    })
    await seedStatus({
      id: `${other}/statuses/newest`,
      actorId: other,
      createdAt: BASE + 9 * MINUTE
    })

    await expect(
      getActorStatuses(db, { actorId: author }).then(ids)
    ).resolves.toEqual([
      statusId('d'),
      statusId('c'),
      statusId('b'),
      statusId('a')
    ])
    await expect(
      getActorStatuses(db, { actorId: author, limit: 2 }).then(ids)
    ).resolves.toEqual([statusId('d'), statusId('c')])
    await expect(
      getActorStatuses(db, {
        actorId: author,
        limit: '3' as unknown as number
      }).then(ids)
    ).resolves.toEqual([statusId('d'), statusId('c'), statusId('b')])
    await expect(
      getActorStatuses(db, {
        actorId: author,
        limit: 'all' as unknown as number
      }).then(ids)
    ).resolves.toHaveLength(4)
  })

  it(`reads ${PER_PAGE_LIMIT} statuses when no limit is given`, async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    for (let index = 0; index <= PER_PAGE_LIMIT; index += 1) {
      await seedStatus({
        id: `${author}/statuses/${String(index).padStart(2, '0')}`,
        actorId: author,
        createdAt: BASE + index * MINUTE
      })
    }
    const page = await getActorStatuses(db, { actorId: author })
    expect(page).toHaveLength(PER_PAGE_LIMIT)
    expect(page[0].id).toBe(`${author}/statuses/${PER_PAGE_LIMIT}`)
  })

  it('pages past a cursor status in (createdAt, id) order', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    await seedStatus({ id: statusId('a'), actorId: author, createdAt: BASE })
    await seedStatus({
      id: statusId('c'),
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({
      id: statusId('b'),
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({
      id: statusId('d'),
      actorId: author,
      createdAt: BASE + 2 * MINUTE
    })
    await seedStatus({
      id: statusId('undated'),
      actorId: author,
      createdAt: null
    })
    // A cursor may be another actor's status.
    const foreign = await seedStatus({
      id: `${other}/statuses/foreign`,
      actorId: other,
      createdAt: BASE + MINUTE
    })
    const page = (params: { minStatusId?: string; maxStatusId?: string }) =>
      getActorStatuses(db, { actorId: author, ...params }).then(ids)

    await expect(page({ maxStatusId: statusId('c') })).resolves.toEqual([
      statusId('b'),
      statusId('a')
    ])
    await expect(page({ maxStatusId: statusId('b') })).resolves.toEqual([
      statusId('a')
    ])
    await expect(page({ minStatusId: statusId('b') })).resolves.toEqual([
      statusId('d'),
      statusId('c')
    ])
    await expect(page({ minStatusId: statusId('c') })).resolves.toEqual([
      statusId('d')
    ])
    await expect(
      page({ minStatusId: statusId('a'), maxStatusId: statusId('d') })
    ).resolves.toEqual([statusId('c'), statusId('b')])
    // The foreign cursor ties with b and c on createdAt, and its id sorts
    // after both.
    await expect(page({ maxStatusId: foreign })).resolves.toEqual([
      statusId('c'),
      statusId('b'),
      statusId('a')
    ])
    await expect(page({ minStatusId: foreign })).resolves.toEqual([
      statusId('d')
    ])
    // A cursor no row has is ignored (the undated row, which fails to
    // hydrate, is kept out by the other cursor); an undated one matches
    // nothing.
    await expect(
      page({ minStatusId: statusId('a'), maxStatusId: statusId('gone') })
    ).resolves.toEqual([statusId('d'), statusId('c'), statusId('b')])
    await expect(
      page({ minStatusId: statusId('gone'), maxStatusId: statusId('d') })
    ).resolves.toEqual([statusId('c'), statusId('b'), statusId('a')])
    await expect(page({ maxStatusId: statusId('undated') })).resolves.toEqual(
      []
    )
    await expect(page({ minStatusId: statusId('undated') })).resolves.toEqual(
      []
    )
  })

  it('filters by audience: public, the viewer’s, the followers’, or none', async () => {
    const prefix = nextPrefix()
    const followersUrl = `https://${DOMAIN}/collections/${prefix}-followers`
    const author = await seedActor(actorIn(prefix, 'author'), { followersUrl })
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    let minute = 0
    const write = (name: string, values: Partial<SeedStatus>) =>
      seedStatus({
        id: statusId(name),
        actorId: author,
        createdAt: BASE + ++minute * MINUTE,
        ...values
      })
    const publicNote = await seedStatus({
      id: `${other}/statuses/public`,
      actorId: other
    })
    const privateNote = await seedStatus({
      id: `${other}/statuses/private`,
      actorId: other,
      to: [`${other}/followers`]
    })
    await write('public', {})
    await write('unlisted', {
      to: [followersUrl],
      cc: [ACTIVITY_STREAM_PUBLIC]
    })
    await write('stored-followers', { to: [followersUrl] })
    await write('default-followers', { to: [`${author}/followers`] })
    await write('to-viewer', { to: [viewer] })
    await write('to-other', { to: [other] })
    await write('boost-public', {
      type: StatusType.enum.Announce,
      originalStatusId: publicNote
    })
    await write('boost-private', {
      type: StatusType.enum.Announce,
      originalStatusId: privateNote
    })
    const read = (params: Record<string, unknown>) =>
      getActorStatuses(db, { actorId: author, ...params }).then((statuses) =>
        ids(statuses).map((id) => id?.slice(statusId('').length))
      )

    await expect(read({})).resolves.toEqual([
      'boost-private',
      'boost-public',
      'to-other',
      'to-viewer',
      'default-followers',
      'stored-followers',
      'unlisted',
      'public'
    ])
    await expect(
      read({ publicOnly: true, visibleToActorId: viewer })
    ).resolves.toEqual(['boost-public', 'unlisted', 'public'])
    // The non-public filter takes a boost by its own recipients.
    await expect(read({ visibleToActorId: viewer })).resolves.toEqual([
      'boost-private',
      'boost-public',
      'to-viewer',
      'unlisted',
      'public'
    ])
    await expect(
      read({ includeFollowersOnly: true, followersAudience: followersUrl })
    ).resolves.toEqual([
      'boost-private',
      'boost-public',
      'default-followers',
      'stored-followers',
      'unlisted',
      'public'
    ])
    await expect(read({ includeFollowersOnly: true })).resolves.toEqual([
      'boost-private',
      'boost-public',
      'default-followers',
      'unlisted',
      'public'
    ])
    await expect(
      read({
        includeFollowersOnly: true,
        followersAudience: followersUrl,
        visibleToActorId: viewer
      })
    ).resolves.toEqual([
      'boost-private',
      'boost-public',
      'to-viewer',
      'default-followers',
      'stored-followers',
      'unlisted',
      'public'
    ])
    // The Announces are hydrated as boosts or dropped when unreadable: the
    // filter only decides which rows are read.
    const statuses = await getActorStatuses(db, {
      actorId: author,
      publicOnly: true
    })
    expect(statuses[0]).toMatchObject({
      type: StatusType.enum.Announce,
      originalStatus: expect.objectContaining({ id: publicNote })
    })
  })

  it('filters to media, original posts and self-replies, non-boosts, a hashtag, or pins', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    let minute = 0
    const write = (name: string, values: Partial<SeedStatus> = {}) =>
      seedStatus({
        id: statusId(name),
        actorId: author,
        createdAt: BASE + ++minute * MINUTE,
        ...values
      })
    const otherNote = await seedStatus({
      id: `${other}/statuses/note`,
      actorId: other,
      url: `${other}/@note`
    })
    const ownRoot = await write('root', { url: `${author}/@root` })
    await write('media')
    await attach(statusId('media'), author, `https://${DOMAIN}/${prefix}.webp`)
    await attach(otherNote, other, `https://${DOMAIN}/${prefix}-other.webp`)
    await write('no-reply', { reply: '' })
    await write('self-reply-by-id', { reply: ownRoot })
    await write('self-reply-by-url', {
      reply: `${author}/@root`,
      replyHash: getHashFromString(`${author}/@root`)
    })
    await write('self-reply-url-wrong-hash', {
      reply: `${author}/@root`,
      replyHash: 'wrong'
    })
    // The root's url hash, under another url (a hash collision).
    await write('self-reply-hash-collision', {
      reply: `${author}/@other`,
      replyHash: getHashFromString(`${author}/@root`)
    })
    await write('reply-to-other-by-id', { reply: otherNote })
    await write('reply-to-other-by-url', { reply: `${other}/@note` })
    await write('reply-to-missing', { reply: `${author}/statuses/gone` })
    await write('boost', {
      type: StatusType.enum.Announce,
      originalStatusId: otherNote
    })
    await write('poll', {
      type: StatusType.enum.Poll,
      content: { text: '<p>?</p>', endAt: BASE + 86_400_000 }
    })
    await write('tagged')
    await tag(statusId('tagged'), '#Reads')
    await write('emoji-tagged')
    await tag(statusId('emoji-tagged'), '#reads', 'emoji')
    await write('other-tag')
    await tag(statusId('other-tag'), '#readsmore')
    await tag(otherNote, '#reads')
    await write('pinned')
    await write('pinned-by-other')
    await db
      .insertInto('status_pins')
      .values([
        { actorId: author, statusId: statusId('pinned') },
        { actorId: other, statusId: statusId('pinned-by-other') },
        { actorId: author, statusId: otherNote }
      ])
      .execute()

    const read = (params: Record<string, unknown>) =>
      getActorStatuses(db, { actorId: author, limit: 100, ...params }).then(
        (statuses) => ids(statuses).map((id) => id?.slice(statusId('').length))
      )

    await expect(read({ onlyMedia: true })).resolves.toEqual(['media'])
    await expect(read({ excludeReplies: true })).resolves.toEqual([
      'pinned-by-other',
      'pinned',
      'other-tag',
      'emoji-tagged',
      'tagged',
      'poll',
      'boost',
      'self-reply-by-url',
      'self-reply-by-id',
      'no-reply',
      'media',
      'root'
    ])
    await expect(read({ excludeReblogs: true, limit: 3 })).resolves.toEqual([
      'pinned-by-other',
      'pinned',
      'other-tag'
    ])
    await expect(read({ excludeReblogs: true })).resolves.not.toContain('boost')
    await expect(read({ excludeReblogs: true })).resolves.toHaveLength(16)
    for (const tagged of ['reads', '#reads', 'READS', '#Reads']) {
      await expect(read({ tagged })).resolves.toEqual(['tagged'])
    }
    // A tag that normalizes to nothing matches nothing.
    await expect(read({ tagged: '' })).resolves.toEqual([])
    await expect(read({ tagged: '#' })).resolves.toEqual([])
    // A null one is no filter.
    await expect(read({ tagged: null })).resolves.toHaveLength(17)
    await expect(read({ pinned: true })).resolves.toEqual(['pinned'])
    await expect(
      read({ onlyMedia: true, excludeReplies: true, pinned: true })
    ).resolves.toEqual([])
  })

  it('keeps a status with a NULL reply under excludeReplies, which hydration then rejects as before', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = await seedStatus({
      id: `${author}/statuses/null-reply`,
      actorId: author,
      reply: null
    })
    await seedStatus({
      id: `${author}/statuses/reply`,
      actorId: author,
      reply: `${author}/statuses/gone`
    })
    // Only the NULL-reply row is selected, and it fails to hydrate.
    await expect(
      getActorStatuses(db, { actorId: author, excludeReplies: true })
    ).rejects.toThrow(/reply/)
    await db
      .updateTable('statuses')
      .set({ reply: '' })
      .where('id', '=', statusId)
      .execute()
    await expect(
      getActorStatuses(db, { actorId: author, excludeReplies: true }).then(ids)
    ).resolves.toEqual([statusId])
  })

  it('hydrates the page for the current actor', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const liked = await seedStatus({
      id: `${author}/statuses/liked`,
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({ id: `${author}/statuses/plain`, actorId: author })
    await like(liked, viewer)
    const statuses = (await getActorStatuses(db, {
      actorId: author,
      currentActorId: viewer
    })) as StatusNote[]
    expect(statuses.map((status) => [status.id, status.isActorLiked])).toEqual([
      [liked, true],
      [`${author}/statuses/plain`, false]
    ])
  })
})

describe('getStatusesByIds', () => {
  it('returns nothing for no ids, without a query', async () => {
    const { result, statements } = await capture(() =>
      getStatusesByIds(db, { statusIds: [], currentActorId: 'viewer' })
    )
    expect(result).toEqual([])
    expect(statements).toEqual([])
  })

  it('returns the statuses in the order asked for, a repeated id each time, a missing one never', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    await seedStatus({ id: statusId('a'), actorId: author, createdAt: BASE })
    await seedStatus({
      id: statusId('b'),
      actorId: author,
      createdAt: BASE + MINUTE
    })
    await seedStatus({
      id: statusId('c'),
      actorId: author,
      createdAt: BASE + 2 * MINUTE
    })

    await expect(
      getStatusesByIds(db, {
        statusIds: [
          statusId('b'),
          statusId('gone'),
          statusId('a'),
          statusId('b')
        ]
      }).then(ids)
    ).resolves.toEqual([statusId('b'), statusId('a'), statusId('b')])
    // Each id is read once.
    const { statements } = await capture(() =>
      getStatusesByIds(db, { statusIds: [statusId('c'), statusId('c')] })
    )
    expect(statements[0].bindings).toEqual([statusId('c')])
    // An undefined element is skipped.
    await expect(
      getStatusesByIds(db, {
        statusIds: [statusId('c'), undefined as unknown as string]
      }).then(ids)
    ).resolves.toEqual([statusId('c')])
  })

  it('keeps what the viewer may read, and adds replies when asked', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    await seedStatus({ id: statusId('public'), actorId: author })
    await seedStatus({
      id: statusId('to-viewer'),
      actorId: author,
      to: [viewer]
    })
    await seedStatus({
      id: statusId('to-other'),
      actorId: author,
      to: [other]
    })
    await seedStatus({
      id: `${other}/statuses/reply`,
      actorId: other,
      reply: statusId('public'),
      createdAt: BASE + MINUTE
    })
    const asked = [
      statusId('to-other'),
      statusId('to-viewer'),
      statusId('public')
    ]

    await expect(
      getStatusesByIds(db, { statusIds: asked }).then(ids)
    ).resolves.toEqual(asked)
    await expect(
      getStatusesByIds(db, { statusIds: asked, visibleToActorId: viewer }).then(
        ids
      )
    ).resolves.toEqual([statusId('to-viewer'), statusId('public')])
    await expect(
      getStatusesByIds(db, { statusIds: asked, visibleToActorId: other }).then(
        ids
      )
    ).resolves.toEqual([statusId('to-other'), statusId('public')])

    const [withReplies] = (await getStatusesByIds(db, {
      statusIds: [statusId('public')],
      withReplies: true
    })) as StatusNote[]
    expect(withReplies.replies.map((reply) => reply.id)).toEqual([
      `${other}/statuses/reply`
    ])
    const [withoutReplies] = (await getStatusesByIds(db, {
      statusIds: [statusId('public')]
    })) as StatusNote[]
    expect(withoutReplies.replies).toEqual([])
  })
})

describe('status counts', () => {
  it('reads the reblog counter of one status, 0 without one', async () => {
    const prefix = nextPrefix()
    const statusId = `https://${DOMAIN}/users/${prefix}/statuses/1`
    await setCounter(CounterKey.totalReblog(statusId), 4)
    await setCounter(CounterKey.totalReblog(`${statusId}0`), 40)
    await setCounter(CounterKey.totalLike(statusId), 400)
    await expect(getStatusReblogsCount(db, { statusId })).resolves.toBe(4)
    await expect(
      getStatusReblogsCount(db, { statusId: `${statusId}/` })
    ).resolves.toBe(0)
  })

  it('reads the reblog and reply counters of many statuses, every one asked for', async () => {
    const prefix = nextPrefix()
    const statusId = (index: number) =>
      `https://${DOMAIN}/users/${prefix}/statuses/${index}`
    // More ids than one IN list takes.
    const count = getWhereInBatchSize(db) + 5
    const statusIds = Array.from({ length: count }, (_, index) =>
      statusId(index)
    )
    await db
      .insertInto('counters')
      .values(
        statusIds.flatMap((id, index) => [
          { id: CounterKey.totalReblog(id), value: index + 1 },
          { id: CounterKey.totalReply(id), value: (index + 1) * 10 }
        ])
      )
      .execute()

    const asked = [...statusIds, statusId(0), statusId(count)]
    const reblogs = await getStatusReblogsCounts(db, { statusIds: asked })
    expect(Object.keys(reblogs)).toHaveLength(count + 1)
    expect(reblogs[statusId(0)]).toBe(1)
    expect(reblogs[statusId(count - 1)]).toBe(count)
    expect(reblogs[statusId(count)]).toBe(0)
    const replies = await getStatusRepliesCounts(db, { statusIds: asked })
    expect(replies[statusId(0)]).toBe(10)
    expect(replies[statusId(count - 1)]).toBe(count * 10)
    expect(replies[statusId(count)]).toBe(0)

    const { result, statements } = await capture(() =>
      getStatusReblogsCounts(db, { statusIds: [] })
    )
    expect(result).toEqual({})
    expect(statements).toEqual([])
    await expect(
      getStatusRepliesCounts(db, { statusIds: [] })
    ).resolves.toEqual({})
  })

  it('reads the reply counter, or counts the replies by id or url that are not boosts', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const replier = await seedActor(actorIn(prefix, 'replier'))
    const parent = await seedStatus({
      id: `${author}/statuses/parent`,
      actorId: author,
      url: `${author}/@parent`
    })
    await setCounter(CounterKey.totalReply(parent), 99)
    const reply = (name: string, values: Partial<SeedStatus>) =>
      seedStatus({
        id: `${replier}/statuses/${name}`,
        actorId: replier,
        ...values
      })
    await reply('by-id', { reply: parent })
    await reply('by-url', { reply: `${author}/@parent` })
    await reply('followers', {
      reply: parent,
      to: [`${replier}/followers`]
    })
    await reply('boost', {
      reply: parent,
      type: StatusType.enum.Announce,
      originalStatusId: parent
    })
    await reply('elsewhere', { reply: `${author}/statuses/other` })

    await expect(getStatusRepliesCount(db, { statusId: parent })).resolves.toBe(
      99
    )
    await expect(
      getStatusRepliesCount(db, { statusId: parent, url: `${author}/@parent` })
    ).resolves.toBe(3)
    await expect(
      getStatusRepliesCount(db, { statusId: parent, publicOnly: true })
    ).resolves.toBe(1)
    await expect(
      getStatusRepliesCount(db, {
        statusId: parent,
        url: `${author}/@parent`,
        publicOnly: true
      })
    ).resolves.toBe(2)
    await expect(
      getStatusRepliesCount(db, {
        statusId: `${author}/statuses/none`,
        url: `${author}/@none`
      })
    ).resolves.toBe(0)
  })

  it.runIf(testDb.backend === 'pg')(
    'rejects a counter past 2^53 - 1 on PostgreSQL rather than clamping it, in the counts and in hydration',
    async () => {
      const prefix = nextPrefix()
      const author = await seedActor(actorIn(prefix, 'author'))
      const statusId = await seedStatus({
        id: `${author}/statuses/1`,
        actorId: author
      })
      const tooLarge = 2 ** 53 + 2
      await db
        .insertInto('counters')
        .values([
          { id: CounterKey.totalStatus(author), value: tooLarge },
          { id: CounterKey.totalReblog(statusId), value: tooLarge },
          { id: CounterKey.totalReply(statusId), value: tooLarge }
        ])
        .execute()
      await expect(
        getActorStatusesCount(db, { actorId: author })
      ).rejects.toThrow(RangeError)
      await expect(getStatusReblogsCount(db, { statusId })).rejects.toThrow(
        RangeError
      )
      await expect(
        getStatusReblogsCounts(db, { statusIds: [statusId] })
      ).rejects.toThrow(RangeError)
      await expect(getStatusRepliesCount(db, { statusId })).rejects.toThrow(
        RangeError
      )
      await expect(
        getStatusRepliesCounts(db, { statusIds: [statusId] })
      ).rejects.toThrow(RangeError)
      // Hydration reads a status's like and boost totals. Each is large on a
      // status whose author's own counters are in range (the author above has
      // an out-of-range total, which fails hydration on its own); hydration
      // throws rather than read it as 9,007,199,254,740,991.
      for (const [name, counterKey] of [
        ['like', CounterKey.totalLike],
        ['boost', CounterKey.totalReblog]
      ] as const) {
        const other = await seedActor(actorIn(prefix, `hydrated-${name}`))
        const hydrated = await seedStatus({
          id: `${other}/statuses/1`,
          actorId: other
        })
        await db
          .insertInto('counters')
          .values({ id: counterKey(hydrated), value: tooLarge })
          .execute()
        await expect(getStatus(db, { statusId: hydrated })).rejects.toThrow(
          RangeError
        )
      }
    }
  )

  it.runIf(testDb.backend === 'pg')(
    'rejects a fitness file whose bytes pass 2^53 - 1 on PostgreSQL, in hydration',
    async () => {
      const prefix = nextPrefix()
      const author = await seedActor(actorIn(prefix, 'author'))
      const statusId = await seedStatus({
        id: `${author}/statuses/1`,
        actorId: author
      })
      const neighbourId = await seedStatus({
        id: `${author}/statuses/2`,
        actorId: author
      })
      const file = (id: string, owner: string, bytes: number | string) => ({
        id: `${prefix}-${id}`,
        actorId: author,
        statusId: owner,
        path: `fitness/${prefix}-${id}.fit`,
        fileName: `${id}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: bytes as number,
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      await db
        .insertInto('fitness_files')
        .values([
          file('neighbour', neighbourId, 2048),
          // 9,007,199,254,740,993, which Number() would round to
          // 9,007,199,254,740,992.
          file('large', statusId, '9007199254740993')
        ])
        .execute()
      await expect(getStatus(db, { statusId })).rejects.toThrow(RangeError)
      // The neighbour's own file, within the range, still hydrates.
      await expect(
        getStatus(db, { statusId: neighbourId }).then(
          (status) => (status as StatusNote).fitness?.bytes
        )
      ).resolves.toBe(2048)
    }
  )

  it.runIf(testDb.backend === 'pg')(
    'throws the driver’s own message for a database error, without the statement in front',
    async () => {
      const prefix = nextPrefix()
      const author = await seedActor(actorIn(prefix, 'author'))
      // Not prefixed with the statement (select * from "statuses" where
      // "actorId" = $1 order by ... limit $2 - LIMIT must not be negative).
      await expect(
        getActorStatuses(db, { actorId: author, limit: -1 })
      ).rejects.toMatchObject({ message: 'LIMIT must not be negative' })
    }
  )
})

describe('null and undefined keys', () => {
  it('reads an undefined key as NULL, matching no row', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const replier = await seedActor(actorIn(prefix, 'replier'))
    const url = `${author}/@parent`
    await seedStatus({ id: `${author}/statuses/parent`, actorId: author, url })
    const byUrl = await seedStatus({
      id: `${replier}/statuses/by-url`,
      actorId: replier,
      reply: url
    })
    const missing = undefined as unknown as string

    await expect(getActorStatuses(db, { actorId: missing })).resolves.toEqual(
      []
    )
    await expect(
      getActorStatuses(db, { actorId: missing, publicOnly: true })
    ).resolves.toEqual([])
    await expect(
      getActorStatusesCount(db, { actorId: missing, publicOnly: true })
    ).resolves.toBe(0)
    // With a url, the replies by url are still read.
    await expect(
      getStatusReplies(db, { statusId: missing, url }).then(ids)
    ).resolves.toEqual([byUrl])
    await expect(
      getStatusRepliesCount(db, { statusId: missing, url })
    ).resolves.toBe(1)
    await expect(
      getStatusRepliesCount(db, { statusId: missing, publicOnly: true })
    ).resolves.toBe(0)
  })

  it('reads a null key as matching no row, not even the rows with NULL there', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    // Rows with NULL in the keys these reads filter on, which a null key must
    // not match.
    const noReply = await seedStatus({
      id: `${author}/statuses/no-reply`,
      actorId: author,
      reply: null
    })
    const noAuthor = await seedStatus({
      id: `${author}/statuses/no-author`,
      actorId: null as unknown as string
    })
    const [revision] = await db
      .insertInto('status_history')
      .values({
        statusId: null,
        data: JSON.stringify({ text: 'orphan' }),
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .returning('id')
      .execute()
    // SQLite's statuses.id allows a NULL; PostgreSQL's does not.
    if (testDb.backend === 'sqlite') {
      await db
        .insertInto('statuses')
        .values({
          id: null as unknown as string,
          actorId: author,
          type: StatusType.enum.Note,
          reply: '',
          content: JSON.stringify({ text: 'no id' }),
          createdAt: new Date(BASE),
          updatedAt: new Date(BASE)
        })
        .execute()
    }
    const missing = null as unknown as string
    try {
      await expect(getStatus(db, { statusId: missing })).resolves.toBeNull()
      await expect(
        getStatusEditHistory(db, { statusId: missing })
      ).resolves.toEqual([])
      await expect(
        getStatusReplies(db, { statusId: missing })
      ).resolves.toEqual([])
      await expect(
        getStatusReplies(db, { statusId: missing, publicOnly: true })
      ).resolves.toEqual([])
      await expect(
        getStatusRepliesCount(db, { statusId: missing, publicOnly: true })
      ).resolves.toBe(0)
      await expect(
        getStatusRepliesCount(db, { statusId: missing, url: `${author}/@x` })
      ).resolves.toBe(0)
      await expect(getActorStatuses(db, { actorId: missing })).resolves.toEqual(
        []
      )
      await expect(
        getActorStatuses(db, { actorId: missing, publicOnly: true })
      ).resolves.toEqual([])
      await expect(
        getActorStatusesCount(db, { actorId: missing, publicOnly: true })
      ).resolves.toBe(0)
    } finally {
      await db
        .deleteFrom('statuses')
        .where((eb) =>
          eb.or([eb('id', 'in', [noReply, noAuthor]), eb('id', 'is', null)])
        )
        .execute()
      await db
        .deleteFrom('recipients')
        .where('statusId', 'in', [noReply, noAuthor])
        .execute()
      await db
        .deleteFrom('status_history')
        .where('id', '=', revision.id)
        .execute()
    }
  })
})

describe('hydration context', () => {
  it('collects the Notes and Polls a page shows, down boost chains', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    await seedStatus({ id: statusId('note'), actorId: author })
    await seedStatus({
      id: statusId('poll'),
      actorId: author,
      type: StatusType.enum.Poll,
      content: { text: '<p>?</p>', endAt: BASE }
    })
    await seedStatus({
      id: statusId('boost'),
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('poll')
    })
    await seedStatus({
      id: statusId('legacy-boost'),
      actorId: author,
      type: StatusType.enum.Announce,
      content: statusId('note')
    })
    await seedStatus({
      id: statusId('boost-of-boost'),
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('boost')
    })
    await seedStatus({
      id: statusId('dangling'),
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('gone')
    })
    // A loop of boosts ends.
    await seedStatus({
      id: statusId('loop-a'),
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('loop-b')
    })
    await seedStatus({
      id: statusId('loop-b'),
      actorId: author,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('loop-a')
    })
    const rows = (names: string[]) =>
      db
        .selectFrom('statuses')
        .selectAll()
        .where(
          'id',
          'in',
          names.map((name) => statusId(name))
        )
        .execute() as Promise<StatusRow[]>

    await expect(
      collectHydrationStatusIds(
        db,
        await rows(['boost-of-boost', 'legacy-boost', 'dangling', 'loop-a'])
      )
    ).resolves.toEqual(new Set([statusId('poll'), statusId('note')]))
    await expect(
      collectHydrationStatusIds(db, await rows(['note', 'boost']))
    ).resolves.toEqual(new Set([statusId('note'), statusId('poll')]))

    const { result, statements } = await capture(() =>
      collectHydrationStatusIds(db, [])
    )
    expect(result).toEqual(new Set())
    expect(statements).toEqual([])
  })

  it('follows a boost chain ten reads deep and no further', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    // boost-0 -> boost-1 -> ... -> boost-10 -> note
    await seedStatus({ id: statusId('note'), actorId: author })
    for (let index = 10; index >= 0; index -= 1) {
      await seedStatus({
        id: statusId(`boost-${index}`),
        actorId: author,
        type: StatusType.enum.Announce,
        originalStatusId:
          index === 10 ? statusId('note') : statusId(`boost-${index + 1}`)
      })
    }
    const row = (name: string) =>
      db
        .selectFrom('statuses')
        .selectAll()
        .where('id', '=', statusId(name))
        .execute() as Promise<StatusRow[]>

    // From boost-1 the note is the tenth read; from boost-0 the eleventh.
    await expect(
      collectHydrationStatusIds(db, await row('boost-1'))
    ).resolves.toEqual(new Set([statusId('note')]))
    await expect(
      collectHydrationStatusIds(db, await row('boost-0'))
    ).resolves.toEqual(new Set())
  })

  it('batches the viewer’s likes, bookmarks and boosts of a page, and nothing without a viewer', async () => {
    const prefix = nextPrefix()
    const author = await seedActor(actorIn(prefix, 'author'))
    const viewer = await seedActor(actorIn(prefix, 'viewer'))
    const other = await seedActor(actorIn(prefix, 'other'))
    const statusId = (name: string) => `${author}/statuses/${name}`
    for (const name of ['a', 'b', 'c']) {
      await seedStatus({ id: statusId(name), actorId: author })
    }
    await like(statusId('a'), viewer)
    await like(statusId('b'), other)
    await like(statusId('c'), viewer)
    await bookmark(statusId('b'), viewer)
    await bookmark(statusId('a'), other)
    // The viewer's bookmark and boost of a status the page does not show.
    await bookmark(statusId('c'), viewer)
    await seedStatus({
      id: `${viewer}/statuses/boost-c`,
      actorId: viewer,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('c')
    })
    await seedStatus({
      id: `${viewer}/statuses/boost-a`,
      actorId: viewer,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('a')
    })
    await seedStatus({
      id: `${other}/statuses/boost-b`,
      actorId: other,
      type: StatusType.enum.Announce,
      originalStatusId: statusId('b')
    })
    // A Note of the viewer's with an originalStatusId is not a boost.
    await seedStatus({
      id: `${viewer}/statuses/note-b`,
      actorId: viewer,
      originalStatusId: statusId('b')
    })

    await expect(
      buildViewerHydration(db, [statusId('a'), statusId('b')], viewer)
    ).resolves.toEqual({
      likedStatusIds: new Set([statusId('a')]),
      bookmarkedStatusIds: new Set([statusId('b')]),
      announcedStatusIds: new Map([
        [statusId('a'), `${viewer}/statuses/boost-a`]
      ])
    })

    const empty = await capture(() => buildViewerHydration(db, [], viewer))
    expect(empty.result).toEqual({
      likedStatusIds: new Set(),
      bookmarkedStatusIds: new Set(),
      announcedStatusIds: new Map()
    })
    expect(empty.statements).toEqual([])
    const anonymous = await capture(() =>
      buildViewerHydration(db, [statusId('a')])
    )
    expect(anonymous.result).toBeNull()
    expect(anonymous.statements).toEqual([])
  })

  it('batches reactions, quote edges and link previews, with an entry for every status asked for', async () => {
    const prefix = nextPrefix()
    const seed = await seedRichNote(prefix)
    const quietId = await seedStatus({
      id: `${seed.author}/statuses/quiet`,
      actorId: seed.author
    })

    const reactions = await buildReactionRollupContext(
      db,
      [seed.noteId, quietId],
      seed.other
    )
    expect(reactions).toEqual(
      new Map([
        [
          seed.noteId,
          [
            {
              name: ':blob:',
              count: 1,
              me: false,
              url: `https://${DOMAIN}/blob.png`,
              static_url: `https://${DOMAIN}/blob.png`
            },
            { name: '👍', count: 1, me: true, url: null, static_url: null }
          ]
        ],
        [quietId, []]
      ])
    )
    const noReactions = await capture(() =>
      buildReactionRollupContext(db, [], seed.viewer)
    )
    expect(noReactions.result).toEqual(new Map())
    expect(noReactions.statements).toEqual([])

    // The quoted status's url comes from its row, null once it is gone.
    await db
      .insertInto('status_quotes')
      .values({
        statusId: quietId,
        quotedStatusId: `${seed.other}/statuses/gone`,
        state: 'revoked',
        createdAt: new Date(BASE),
        updatedAt: new Date(BASE)
      })
      .execute()
    await expect(
      getStatusQuoteEdges(db, [seed.noteId, quietId, seed.parent])
    ).resolves.toEqual(
      new Map([
        [
          seed.noteId,
          {
            quotedStatusId: seed.quoted,
            quotedStatusUrl: `${seed.other}/@quoted`,
            state: 'accepted',
            authorizationUri: `${seed.quoted}/authorization`
          }
        ],
        [
          quietId,
          {
            quotedStatusId: `${seed.other}/statuses/gone`,
            quotedStatusUrl: null,
            state: 'revoked',
            authorizationUri: null
          }
        ]
      ])
    )
    const noEdges = await capture(() => getStatusQuoteEdges(db, []))
    expect(noEdges.result).toEqual(new Map())
    expect(noEdges.statements).toEqual([])

    // Only the completed card; the neighbour's pending one is left out.
    const previews = await getStatusLinkPreviewsForIds(db, [
      seed.noteId,
      seed.neighbourId,
      quietId
    ])
    expect([...previews.keys()]).toEqual([seed.noteId])
    expect(previews.get(seed.noteId)).toMatchObject({
      url: seed.previewUrl,
      title: 'News'
    })

    // The whole context of a page holding a boost of the note.
    const boost = (await db
      .selectFrom('statuses')
      .selectAll()
      .where('id', '=', `${seed.viewer}/statuses/boost-of-note`)
      .executeTakeFirstOrThrow()) as StatusRow
    const context = await buildStatusHydrationContext(db, [boost], seed.viewer)
    expect(context).toEqual({
      detectedLanguages: { [seed.noteId]: 'ja' },
      quoteEdges: new Map([[seed.noteId, expect.any(Object)]]),
      linkPreviews: new Map([[seed.noteId, expect.any(Object)]]),
      reactionRollups: new Map([[seed.noteId, expect.any(Array)]]),
      likedStatusIds: new Set([seed.noteId]),
      bookmarkedStatusIds: new Set([seed.noteId]),
      announcedStatusIds: new Map([
        [seed.noteId, `${seed.viewer}/statuses/boost-of-note`]
      ])
    })
    await expect(
      buildStatusHydrationContext(db, [boost])
    ).resolves.not.toHaveProperty('likedStatusIds')
  })
})
