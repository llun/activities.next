import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { ACCOUNT_IMPORT_ITEM_PAGE_SIZE } from '@/lib/services/accountImport/constants'
import type { AccountImportObjectStore } from '@/lib/services/accountImport/objectStore'
import type { AccountImportPhaseContext } from '@/lib/services/accountImport/phases'
import {
  getAccountImportItemPosition,
  runCatalogPhase,
  runStatusesPhase
} from '@/lib/services/accountImport/phases'
import {
  createInitialImportProgress,
  serializeImportCursor
} from '@/lib/services/accountImport/progress'
import { ZipArchiveError } from '@/lib/services/accountImport/zip/reader'
import {
  buildZip,
  sourceOf
} from '@/lib/services/accountImport/zip/testing/fixtures'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'
import { TEST_DOMAIN } from '@/lib/stub/const'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { seedActor2 } from '@/lib/stub/seed/actor2'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

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
})
