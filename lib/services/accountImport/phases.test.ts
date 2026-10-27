import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { ACCOUNT_IMPORT_ITEM_PAGE_SIZE } from '@/lib/services/accountImport/constants'
import {
  AccountImportArchiveChangedError,
  type AccountImportObjectStore
} from '@/lib/services/accountImport/objectStore'
import type { AccountImportPhaseContext } from '@/lib/services/accountImport/phases'
import {
  getAccountImportItemPosition,
  runCatalogPhase,
  runMastodonMediaPhase,
  runStatusesPhase
} from '@/lib/services/accountImport/phases'
import {
  type AccountImportProgress,
  createInitialImportProgress,
  serializeImportCursor
} from '@/lib/services/accountImport/progress'
import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'
import {
  buildZip,
  sourceOf
} from '@/lib/services/accountImport/zip/testing/fixtures'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { saveMedia } from '@/lib/services/medias'
import { MediaValidationError } from '@/lib/services/medias/errors'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

vi.mock('@/lib/services/medias', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveMedia: vi.fn()
}))

describe('account import phases', () => {
  const testDb = createTestDatabase({ backend: 'sqlite' })
  const { database, db, prepare, destroy } = testDb
  let actorId: string
  let otherActorId: string
  let accountId: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    await database.createAccount({
      ...seedActor2,
      email: 'test-import-author@llun.test',
      username: 'import-author',
      domain: TEST_DOMAIN
    })
    const actor = await database.getActorFromEmail({ email: seedActor1.email })
    const otherActor = await database.getActorFromEmail({
      email: 'test-import-author@llun.test'
    })
    actorId = actor!.id
    otherActorId = otherActor!.id
    accountId = actor!.account!.id
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('account_import_items').execute()
    await db.deleteFrom('account_imports').execute()
  })

  it('resumes statuses from cataloged JSON without reopening the archive', async () => {
    const accountImport = await database.createAccountImport({
      id: 'import-status-resume',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const sourceActorId = 'https://source.test/users/archive'
    const rawStatus = JSON.stringify({
      id: `${sourceActorId}/activities/2`,
      type: 'Announce',
      actor: sourceActorId,
      published: '2024-02-03T04:05:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${sourceActorId}/followers`],
      object: `${sourceActorId}/statuses/1`
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        { kind: 'status', sourceId: 'already-processed', position: 1 },
        {
          kind: 'status',
          sourceId: 'pending-status',
          position: 2,
          data: rawStatus
        }
      ]
    })
    const alreadyProcessed = (
      await database.getAccountImportItems({
        importId: accountImport.id,
        limit: 1
      })
    )[0]
    await database.markAccountImportItem({
      id: alreadyProcessed.id,
      state: 'done',
      targetId: 'target-already-processed'
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const openSource = vi
      .fn()
      .mockRejectedValue(new Error('zip source opened after catalog'))
    const objectStore = { openSource } as unknown as AccountImportObjectStore
    const progress = {
      ...createInitialImportProgress(),
      sourceActorId,
      sourceFollowersUrl: `${sourceActorId}/followers`,
      statusOrder: 'oldest-first' as const,
      catalogStage: 'done' as const
    }
    const context: AccountImportPhaseContext = {
      database,
      objectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    const result = await runStatusesPhase(
      context,
      progress,
      serializeImportCursor(1)
    )

    expect(result.result).toBe('done')
    expect(openSource).not.toHaveBeenCalled()
    const imported = (
      await database.getAccountImportItems({
        importId: accountImport.id,
        afterPosition: 1,
        limit: 10
      })
    )[0]
    expect(imported).toMatchObject({
      sourceId: 'pending-status',
      state: 'skipped',
      reason: 'boost',
      data: null
    })
  })

  it('reads status work a page at a time through the state-position index', async () => {
    const accountImport = await database.createAccountImport({
      id: 'import-status-page-query',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const sourceActorId = 'https://source.test/users/archive'
    const rawStatus = JSON.stringify({
      id: `${sourceActorId}/activities/page-query`,
      type: 'Announce',
      actor: sourceActorId,
      published: '2024-02-03T04:05:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${sourceActorId}/followers`],
      object: `${sourceActorId}/statuses/1`
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: `${sourceActorId}/activities/page-query`,
          position: 1,
          data: rawStatus
        }
      ]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const getItems = vi.spyOn(database, 'getAccountImportItems')
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: vi.fn()
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    try {
      await runStatusesPhase(
        context,
        {
          ...createInitialImportProgress(),
          sourceActorId,
          sourceFollowersUrl: `${sourceActorId}/followers`
        },
        null
      )

      expect(getItems).toHaveBeenCalled()
      expect(getItems.mock.calls.map(([params]) => params)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            importId: accountImport.id,
            kinds: ['status', 'like', 'bookmark'],
            states: ['pending'],
            limit: ACCOUNT_IMPORT_ITEM_PAGE_SIZE
          })
        ])
      )
      expect(
        getItems.mock.calls.every(
          ([params]) =>
            params.limit === ACCOUNT_IMPORT_ITEM_PAGE_SIZE &&
            params.states?.length === 1
        )
      ).toBe(true)
    } finally {
      getItems.mockRestore()
    }
  })

  it('resolves a reply and attachment from completed items in an earlier import', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const parentSourceId = `${sourceActorId}/statuses/parent`
    const mediaSourceId = 'media_attachments/previous.png'
    const previous = await database.createAccountImport({
      id: 'import-cross-reference-previous',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: previous.id,
      status: 'running',
      kind: 'mastodon'
    })
    const parentTargetId = `${actorId}/statuses/cross-import-parent`
    await database.createNote({
      id: parentTargetId,
      url: parentTargetId,
      actorId,
      text: 'Previously imported parent',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: []
    })
    const media = await database.createMedia({
      actorId,
      original: {
        path: '/tests/fb1-previous.png',
        bytes: 8,
        mimeType: 'image/png',
        metaData: { width: 1, height: 1 }
      }
    })
    await database.upsertAccountImportItems({
      importId: previous.id,
      actorId,
      items: [
        { kind: 'status', sourceId: parentSourceId, position: 1 },
        { kind: 'media', sourceId: mediaSourceId, position: 2 }
      ]
    })
    const previousItems = await database.getAccountImportItems({
      importId: previous.id,
      limit: 10
    })
    await database.markAccountImportItem({
      id: previousItems.find((item) => item.kind === 'status')!.id,
      state: 'done',
      targetId: parentTargetId
    })
    await database.markAccountImportItem({
      id: previousItems.find((item) => item.kind === 'media')!.id,
      state: 'done',
      targetId: String(media!.id)
    })
    await database.updateAccountImport({ id: previous.id, status: 'cancelled' })

    const current = await database.createAccountImport({
      id: 'import-cross-reference-current',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: current.id,
      status: 'running',
      kind: 'mastodon'
    })
    const childSourceId = `${sourceActorId}/statuses/child`
    const childActivityId = `${sourceActorId}/activities/child`
    const rawStatus = JSON.stringify({
      id: childActivityId,
      type: 'Create',
      actor: sourceActorId,
      published: '2024-02-03T04:05:06.000Z',
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${sourceActorId}/followers`],
      object: {
        id: childSourceId,
        type: 'Note',
        attributedTo: sourceActorId,
        content: 'Reply with an earlier attachment',
        published: '2024-02-03T04:05:06.000Z',
        inReplyTo: parentSourceId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${sourceActorId}/followers`],
        attachment: {
          type: 'Document',
          mediaType: 'image/png',
          url: `https://source.test/${mediaSourceId}`,
          name: 'Previous image'
        }
      }
    })
    await database.upsertAccountImportItems({
      importId: current.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: childSourceId,
          position: 1,
          data: rawStatus
        }
      ]
    })
    const currentImport = (await database.getAccountImport({
      id: current.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: vi.fn()
      } as unknown as AccountImportObjectStore,
      accountImport: currentImport,
      now: () => Date.parse('2024-02-03T04:05:07.000Z'),
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    await runStatusesPhase(
      context,
      {
        ...createInitialImportProgress(),
        sourceActorId,
        sourceFollowersUrl: `${sourceActorId}/followers`
      },
      null
    )

    const childItem = (
      await database.getAccountImportItems({ importId: current.id, limit: 10 })
    )[0]
    expect(childItem).toMatchObject({ state: 'done', reason: null })
    const reply = await db
      .selectFrom('statuses')
      .select('reply')
      .where('id', '=', childItem.targetId!)
      .executeTakeFirst()
    expect(reply?.reply).toBe(parentTargetId)
    const attachment = await db
      .selectFrom('attachments')
      .select('mediaId')
      .where('statusId', '=', childItem.targetId!)
      .executeTakeFirst()
    expect(String(attachment?.mediaId)).toBe(String(media!.id))
  })

  it('marks one item failed after a database error and still imports the next', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const accountImport = await database.createAccountImport({
      id: 'import-item-failure',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const rawNote = (sourceId: string) =>
      JSON.stringify({
        id: `${sourceActorId}/activities/${sourceId}`,
        type: 'Create',
        actor: sourceActorId,
        published: '2024-02-03T04:05:06.000Z',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${sourceActorId}/followers`],
        object: {
          id: `${sourceActorId}/statuses/${sourceId}`,
          type: 'Note',
          attributedTo: sourceActorId,
          content: `Note ${sourceId}`,
          published: '2024-02-03T04:05:06.000Z',
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${sourceActorId}/followers`]
        }
      })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: `${sourceActorId}/statuses/first`,
          position: 1,
          data: rawNote('first')
        },
        {
          kind: 'status',
          sourceId: `${sourceActorId}/statuses/second`,
          position: 2,
          data: rawNote('second')
        }
      ]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: vi.fn()
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => Date.parse('2024-02-03T04:05:07.000Z'),
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }
    const createNoteSpy = vi
      .spyOn(database, 'createNoteWithResult')
      .mockRejectedValueOnce(new Error('database exploded'))

    const result = await runStatusesPhase(
      context,
      {
        ...createInitialImportProgress(),
        sourceActorId,
        sourceFollowersUrl: `${sourceActorId}/followers`
      },
      null
    )

    expect(result.result).toBe('done')
    expect(createNoteSpy).toHaveBeenCalledTimes(2)
    const items = await database.getAccountImportItems({
      importId: accountImport.id,
      limit: 10
    })
    const first = items.find(
      (item) => item.sourceId === `${sourceActorId}/statuses/first`
    )!
    const second = items.find(
      (item) => item.sourceId === `${sourceActorId}/statuses/second`
    )!
    expect(first).toMatchObject({
      state: 'failed',
      reason: 'item_failed',
      targetId: null
    })
    expect(first.data).not.toBeNull()
    expect(second).toMatchObject({ state: 'done', reason: null })
    expect(second.targetId).toBeTruthy()
    const failedStatus = await db
      .selectFrom('statuses')
      .select('id')
      .where('id', '=', first.targetId ?? '')
      .executeTakeFirst()
    expect(failedStatus).toBeUndefined()
  })

  it('caps cataloged item count at an injected limit', async () => {
    const accountImport = await database.createAccountImport({
      id: 'import-catalog-item-cap',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const sourceActorId = 'https://source.test/users/catalog-cap'
    const announcements = Array.from({ length: 3 }, (_, index) => ({
      id: `${sourceActorId}/activities/${index}`,
      type: 'Announce',
      actor: sourceActorId,
      published: `2024-02-03T04:05:0${index}.000Z`,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [`${sourceActorId}/followers`],
      object: `${sourceActorId}/statuses/${index}`
    }))
    const archive = buildZip([
      {
        name: 'outbox.json',
        data: Buffer.from(JSON.stringify({ orderedItems: announcements }))
      }
    ])
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: async () => sourceOf(archive)
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }
    const progress = {
      ...createInitialImportProgress(),
      sourceActorId,
      statusOrder: 'oldest-first' as const
    }

    await expect(runCatalogPhase(context, progress, 2)).rejects.toMatchObject({
      reason: 'too_many_entries',
      message: 'catalog_item_limit_exceeded'
    } satisfies Partial<ZipArchiveError>)
  })

  it('assigns non-overlapping non-negative positions for every catalog kind', () => {
    const maxItems = 3
    const positions = [
      getAccountImportItemPosition('status', 0, maxItems, {
        order: 'oldest-first'
      }),
      getAccountImportItemPosition('status', 0, maxItems, {
        order: 'newest-first'
      }),
      getAccountImportItemPosition('media', 0, maxItems, {
        attachmentIndex: 0
      }),
      getAccountImportItemPosition('media', 2, maxItems, {
        attachmentIndex: 39
      }),
      ...(
        [
          'own-media',
          'like',
          'bookmark',
          'gallery-settings',
          'gallery-gear',
          'fitness-gear',
          'album',
          'fitness-file'
        ] as const
      ).map((kind) => getAccountImportItemPosition(kind, 0, maxItems))
    ]

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(new Set(positions).size).toBe(positions.length)
  })

  const runLikeImport = async (statusId: string, importId: string) => {
    expect(await isLocalFederationDomain(database, statusId)).toBe(true)
    const accountImport = await database.createAccountImport({
      id: importId,
      accountId,
      actorId,
      options: '{"likes":true}'
    })
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'like',
          sourceId: statusId,
          position: 1,
          data: JSON.stringify({ id: statusId })
        }
      ]
    })
    const objectStore = {
      openSource: vi.fn()
    } as unknown as AccountImportObjectStore
    const context: AccountImportPhaseContext = {
      database,
      objectStore,
      accountImport,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    await runStatusesPhase(context, createInitialImportProgress(), null)
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'done'
    })
    return (
      await database.getAccountImportItems({
        importId: accountImport.id,
        limit: 10
      })
    )[0]
  }

  it('likes a public status but skips another actor’s private local status', async () => {
    const privateStatusId = `${otherActorId}/statuses/private-import-like`
    expect(
      await database.getAcceptedOrRequestedFollow({
        actorId,
        targetActorId: otherActorId
      })
    ).toBeNull()
    await database.createNote({
      id: privateStatusId,
      url: privateStatusId,
      actorId: otherActorId,
      to: [`${otherActorId}/followers`],
      cc: [],
      text: 'Private status'
    })

    const privateItem = await runLikeImport(
      privateStatusId,
      'import-private-like'
    )

    expect(privateItem).toMatchObject({
      state: 'skipped',
      reason: 'local_status_missing',
      data: null
    })
    expect(
      await db
        .selectFrom('likes')
        .selectAll()
        .where('actorId', '=', actorId)
        .where('statusId', '=', privateStatusId)
        .execute()
    ).toEqual([])

    const publicStatusId = `${otherActorId}/statuses/public-import-like`
    await database.createNote({
      id: publicStatusId,
      url: publicStatusId,
      actorId: otherActorId,
      to: [ACTIVITY_STREAM_PUBLIC],
      cc: [],
      text: 'Public status'
    })

    const publicItem = await runLikeImport(publicStatusId, 'import-public-like')

    expect(publicItem).toMatchObject({
      state: 'done',
      reason: null,
      data: null
    })
    expect(
      await db
        .selectFrom('likes')
        .selectAll()
        .where('actorId', '=', actorId)
        .where('statusId', '=', publicStatusId)
        .execute()
    ).toHaveLength(1)
  })

  it('ends the import when a full page of stuck replies makes no progress', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const accountImport = await database.createAccountImport({
      id: 'import-stuck-full-page',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const foreignParent = 'https://elsewhere.test/users/someone/statuses/1'
    const ownParentSourceId = `${sourceActorId}/statuses/own-parent`
    const rawNote = (sourceId: string, inReplyTo: string | null) =>
      JSON.stringify({
        id: `${sourceActorId}/activities/${sourceId}`,
        type: 'Create',
        actor: sourceActorId,
        published: '2024-02-03T04:05:06.000Z',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${sourceActorId}/followers`],
        object: {
          id: `${sourceActorId}/statuses/${sourceId}`,
          type: 'Note',
          attributedTo: sourceActorId,
          content: `Note ${sourceId}`,
          published: '2024-02-03T04:05:06.000Z',
          ...(inReplyTo ? { inReplyTo } : null),
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${sourceActorId}/followers`]
        }
      })
    // The parent replies to someone else's post (skipped under the default
    // repliesToOthers: 'skip'); the 25 replies to it are then stuck, and
    // they fill whole pages exactly.
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: ownParentSourceId,
          position: 1,
          data: rawNote('own-parent', foreignParent)
        },
        ...Array.from({ length: 25 }, (_, index) => ({
          kind: 'status',
          sourceId: `${sourceActorId}/statuses/stuck-reply-${index}`,
          position: 2 + index,
          data: rawNote(`stuck-reply-${index}`, ownParentSourceId)
        }))
      ]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: vi.fn()
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => Date.parse('2024-02-03T04:05:07.000Z'),
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }

    // Drive the phase the way the runner does: a budget result starts
    // another pass with a null cursor and the persisted progress.
    let progress: AccountImportProgress = {
      ...createInitialImportProgress(),
      sourceActorId,
      sourceFollowersUrl: `${sourceActorId}/followers`
    }
    let outcome: { result: string; cursor: string | null } = {
      result: 'budget',
      cursor: null
    }
    for (let slice = 0; slice < 5 && outcome.result === 'budget'; slice += 1) {
      const phase = await runStatusesPhase(context, progress, outcome.cursor)
      progress = phase.progress
      outcome = { result: phase.result, cursor: phase.cursor }
    }

    expect(outcome.result).toBe('done')
    const rows = await database.getAccountImportItems({
      importId: accountImport.id,
      limit: 100
    })
    expect(
      rows.find((item) => item.sourceId === ownParentSourceId)
    ).toMatchObject({ state: 'skipped', reason: 'reply-to-other' })
    const stuck = rows.filter((item) => item.sourceId.includes('/stuck-reply-'))
    expect(stuck).toHaveLength(25)
    expect(
      stuck.every(
        (item) =>
          item.state === 'skipped' && item.reason === 'parent_unavailable'
      )
    ).toBe(true)
  })

  const mediaPhaseContext = async (importId: string, readError: unknown) => {
    const accountImport = await database.createAccountImport({
      id: importId,
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const mediaPath = 'media_attachments/changing.png'
    // The entry data must push the archive past the end-record trailer
    // window (up to 65 577 bytes), so the open's own reads never start at
    // offset 0 and only the entry's local header read does.
    const archive = buildZip([
      {
        name: mediaPath,
        data: Buffer.concat([
          Buffer.from('archived media bytes'),
          Buffer.alloc(70_000)
        ])
      }
    ])
    const failingSource = {
      size: archive.length,
      read: async (start: number, endInclusive: number) => {
        if (start === 0) throw readError
        return Buffer.from(archive.subarray(start, endInclusive + 1))
      }
    }
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [{ kind: 'media', sourceId: mediaPath, position: 1 }]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: async () => failingSource
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }
    return { context, mediaPath }
  }

  it('fails the media phase terminally when the archive changes under it', async () => {
    const { context, mediaPath } = await mediaPhaseContext(
      'import-media-archive-changed',
      new AccountImportArchiveChangedError()
    )

    await expect(
      runMastodonMediaPhase(context, createInitialImportProgress(), null)
    ).rejects.toBeInstanceOf(AccountImportArchiveChangedError)
    const item = (
      await database.getAccountImportItems({
        importId: 'import-media-archive-changed',
        limit: 1
      })
    )[0]
    // A changed archive is the import's verdict, never the item's: the row
    // is left pending, not skipped as media_invalid.
    expect(item).toMatchObject({
      kind: 'media',
      sourceId: mediaPath,
      state: 'pending',
      reason: null
    })
  })

  it('marks a media item failed and retryable when the archive read fails transiently', async () => {
    const { context } = await mediaPhaseContext(
      'import-media-transient',
      new Error('S3 unavailable')
    )

    const result = await runMastodonMediaPhase(
      context,
      createInitialImportProgress(),
      null
    )

    // Storage trouble is not the item's verdict: the phase finishes, and
    // the row is failed (re-claimable by a later import), not permanently
    // skipped as media_invalid.
    expect(result.result).toBe('done')
    const item = (
      await database.getAccountImportItems({
        importId: 'import-media-transient',
        limit: 1
      })
    )[0]
    expect(item).toMatchObject({ state: 'failed', reason: 'item_failed' })
  })

  const workingMediaPhaseContext = async (importId: string) => {
    const accountImport = await database.createAccountImport({
      id: importId,
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const mediaPath = 'media_attachments/avatar.png'
    // The PNG signature is enough here: the type is sniffed from the bytes
    // and the schema only checks the file and its type; saveMedia, which
    // would decode the image, is mocked per test below.
    const archive = buildZip([
      {
        name: mediaPath,
        data: Buffer.concat([
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          Buffer.alloc(64)
        ])
      }
    ])
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [{ kind: 'media', sourceId: mediaPath, position: 1 }]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: async () => sourceOf(archive)
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      now: () => 1,
      deadline: Number.MAX_SAFE_INTEGER,
      renew: async () => {}
    }
    return { context, mediaPath }
  }

  it('skips a media item when the account is over its storage quota', async () => {
    const { context } = await workingMediaPhaseContext('import-media-quota')
    vi.mocked(saveMedia).mockRejectedValue(
      new MediaValidationError(
        'Storage quota exceeded. Used: 10 bytes, Limit: 5 bytes'
      )
    )

    const result = await runMastodonMediaPhase(
      context,
      createInitialImportProgress(),
      null
    )

    // A quota refusal is the item's verdict, not a server fault: the row is
    // a permanent skip with its own reason code, never a retryable failure.
    expect(result.result).toBe('done')
    const item = (
      await database.getAccountImportItems({
        importId: 'import-media-quota',
        limit: 1
      })
    )[0]
    expect(item).toMatchObject({
      state: 'skipped',
      reason: 'media_quota_exceeded'
    })
  })

  it('skips a media item whose bytes fail media validation', async () => {
    const { context } = await workingMediaPhaseContext('import-media-invalid')
    vi.mocked(saveMedia).mockRejectedValue(
      new MediaValidationError('Image could not be decoded')
    )

    const result = await runMastodonMediaPhase(
      context,
      createInitialImportProgress(),
      null
    )

    expect(result.result).toBe('done')
    const item = (
      await database.getAccountImportItems({
        importId: 'import-media-invalid',
        limit: 1
      })
    )[0]
    expect(item).toMatchObject({ state: 'skipped', reason: 'media_invalid' })
  })

  it('keeps the pass baseline across slices so a reply left pending is retried', async () => {
    const sourceActorId = 'https://source.test/users/archive'
    const accountImport = await database.createAccountImport({
      id: 'import-pass-baseline',
      accountId,
      actorId,
      options: '{}'
    })
    await database.updateAccountImport({
      id: accountImport.id,
      status: 'running',
      kind: 'mastodon'
    })
    const parentSourceId = `${sourceActorId}/statuses/parent`
    const replySourceId = `${sourceActorId}/statuses/reply`
    const rawNote = (sourceId: string, inReplyTo: string | null) =>
      JSON.stringify({
        id: `${sourceActorId}/activities/${sourceId}`,
        type: 'Create',
        actor: sourceActorId,
        published: '2024-02-03T04:05:06.000Z',
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [`${sourceActorId}/followers`],
        object: {
          id: `${sourceActorId}/statuses/${sourceId}`,
          type: 'Note',
          attributedTo: sourceActorId,
          content: `Note ${sourceId}`,
          published: '2024-02-03T04:05:06.000Z',
          ...(inReplyTo ? { inReplyTo } : null),
          to: [ACTIVITY_STREAM_PUBLIC],
          cc: [`${sourceActorId}/followers`]
        }
      })
    // The reply is listed before its parent, so the first pass leaves it
    // pending; the parent is imported later in the SAME pass, but in
    // ANOTHER slice (the deadline ends every slice after one item).
    await database.upsertAccountImportItems({
      importId: accountImport.id,
      actorId,
      items: [
        {
          kind: 'status',
          sourceId: replySourceId,
          position: 1,
          data: rawNote('reply', parentSourceId)
        },
        {
          kind: 'status',
          sourceId: parentSourceId,
          position: 2,
          data: rawNote('parent', null)
        }
      ]
    })
    const current = (await database.getAccountImport({
      id: accountImport.id,
      actorId
    }))!
    const context: AccountImportPhaseContext = {
      database,
      objectStore: {
        openSource: vi.fn()
      } as unknown as AccountImportObjectStore,
      accountImport: current,
      // The clock sits just after the notes' publication time, and the
      // deadline has already passed: every slice ends after one item, so
      // one pass is split across several slices.
      now: () => Date.parse('2024-02-03T04:05:06.500Z'),
      deadline: Date.parse('2024-02-03T04:05:06.000Z'),
      renew: async () => {}
    }

    // Drive the phase the way the runner does, feeding each slice the
    // cursor and progress the previous one persisted.
    let progress: AccountImportProgress = {
      ...createInitialImportProgress(),
      sourceActorId,
      sourceFollowersUrl: `${sourceActorId}/followers`
    }
    let cursor: string | null = null
    let result = 'budget'
    for (let slice = 0; slice < 10 && result !== 'done'; slice += 1) {
      const phase = await runStatusesPhase(context, progress, cursor)
      progress = phase.progress
      cursor = phase.cursor
      result = phase.result
    }

    expect(result).toBe('done')
    const rows = await database.getAccountImportItems({
      importId: accountImport.id,
      limit: 10
    })
    // The pass baseline must be the one persisted when the pass began, not
    // recomputed at the slice that resumes it: the parent's import counts
    // as pass progress, so the reply gets another pass and is imported.
    expect(rows.find((item) => item.sourceId === parentSourceId)).toMatchObject(
      { state: 'done' }
    )
    expect(rows.find((item) => item.sourceId === replySourceId)).toMatchObject({
      state: 'done',
      reason: null
    })
  })
})
