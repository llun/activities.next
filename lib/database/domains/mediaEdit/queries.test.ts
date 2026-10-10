import { mediaEditQueries } from '@/lib/database/domains/mediaEdit/queries'
import type { MediaEditRender } from '@/lib/database/domains/mediaEdit/types'
import { increaseCounterValue } from '@/lib/database/kysely/counter'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { withStaleFirstRead } from '@/lib/database/testing/staleRead'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'

describe('MediaEditDatabase', () => {
  const testDb = createTestDatabase()
  const { database } = testDb
  let accountId = ''
  let otherAccountId = ''

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
    await seedDatabase(database)
    accountId = (await database.getActorFromId({ id: ACTOR1_ID }))!.account!.id
    otherAccountId = (await database.getActorFromId({ id: ACTOR2_ID }))!
      .account!.id
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  const usage = () => database.getStorageUsageForAccount({ accountId })

  const createPhoto = async (name: string) => {
    const media = await database.createMedia({
      actorId: ACTOR1_ID,
      original: {
        path: `medias/${name}.webp`,
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: {
          width: 4000,
          height: 3000,
          upload: { state: 'verified', clientPath: `uploads/${name}.jpg` }
        }
      },
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.25, y: -0.5 }
    })
    return media!
  }

  const render = (name: string, bytes = 600): MediaEditRender => ({
    path: `medias/${name}.webp`,
    bytes,
    mimeType: 'image/webp',
    width: 2000,
    height: 1500,
    blurhash: 'L00000fQfQfQfQfQfQfQfQfQfQfQ',
    focus: { x: 0, y: 0 }
  })

  const RECIPE = '{"v":1}'

  const slotsOf = async (mediaId: string) =>
    (await database.listMediaEditFiles({ mediaIds: [mediaId] }))
      .map((file) => file.slot.split(':')[0])
      .sort()

  it('moves the uploaded file into the original slot on the first save', async () => {
    const media = await createPhoto('first-save')
    const before = await usage()

    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'save-1',
      recipe: RECIPE,
      render: render('first-save-render')
    })

    expect(result).toMatchObject({ status: 'ok', version: 1, removedPaths: [] })
    if (result.status !== 'ok') return
    expect(result.media.original).toMatchObject({
      path: 'medias/first-save-render.webp',
      bytes: 600,
      mimeType: 'image/webp',
      metaData: { width: 2000, height: 1500 }
    })
    expect(result.media.blurhash).toBe('L00000fQfQfQfQfQfQfQfQfQfQfQ')
    expect(result.media.focus).toEqual({ x: 0, y: 0 })
    expect(result.media.edit?.version).toBe(1)
    expect(result.media.edit?.editedAt).toEqual(expect.any(Number))

    const state = await database.getMediaEditState({ mediaId: media.id })
    expect(state).toMatchObject({
      version: 1,
      recipe: RECIPE,
      saveId: 'save-1',
      masks: [],
      original: {
        slot: 'original',
        path: 'medias/first-save.webp',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: {
          width: 4000,
          height: 3000,
          upload: { clientPath: 'uploads/first-save.jpg' },
          blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
          focus: { x: 0.25, y: -0.5 }
        }
      }
    })
    expect(await usage()).toBe(before + 600)
    expect(
      (await database.getMediaEditFilePaths({ mediaIds: [media.id] })).sort()
    ).toEqual(['medias/first-save.webp', 'uploads/first-save.jpg'])
  })

  it('keeps the previous render as a superseded slot on a later save', async () => {
    const media = await createPhoto('second-save')
    await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'save-1',
      recipe: RECIPE,
      render: render('second-save-a', 600)
    })
    const before = await usage()

    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 1,
      saveId: 'save-2',
      recipe: RECIPE,
      render: render('second-save-b', 700)
    })

    expect(result).toMatchObject({ status: 'ok', version: 2 })
    const files = await database.listMediaEditFiles({ mediaIds: [media.id] })
    expect(files.map((file) => [file.slot.split(':')[0], file.path])).toEqual(
      expect.arrayContaining([
        ['original', 'medias/second-save.webp'],
        ['superseded', 'medias/second-save-a.webp']
      ])
    )
    expect(files).toHaveLength(2)
    expect(await usage()).toBe(before + 700)
  })

  it('answers stale with the current version and save id', async () => {
    const media = await createPhoto('stale')
    await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'stale-save',
      recipe: RECIPE,
      render: render('stale-a')
    })
    const before = await usage()

    const result = await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'stale-retry',
      recipe: RECIPE,
      render: render('stale-b')
    })

    expect(result).toEqual({
      status: 'stale',
      version: 1,
      saveId: 'stale-save'
    })
    expect(await usage()).toBe(before)
    expect(await slotsOf(media.id)).toEqual(['original'])
  })

  it('lets only one of two concurrent saves land', async () => {
    const media = await createPhoto('race')
    await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'race-winner',
      recipe: RECIPE,
      render: render('race-winner')
    })
    const before = await usage()

    // The loser's version check reads the row as it was before the winner
    // committed, so only the guarded update can stop it.
    const racing = withStaleFirstRead(testDb.db, 'medias', (rows) =>
      rows.map((row) => ({ ...row, editVersion: 0, editSaveId: null }))
    )
    const result = await mediaEditQueries.applyMediaEdit(racing, {
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'race-loser',
      recipe: RECIPE,
      render: render('race-loser')
    })

    expect(result).toEqual({
      status: 'stale',
      version: 1,
      saveId: 'race-winner'
    })
    const current = await database.getMediaByIdForAccount({
      mediaId: media.id,
      accountId
    })
    expect(current?.original.path).toBe('medias/race-winner.webp')
    expect(await slotsOf(media.id)).toEqual(['original'])
    expect(await usage()).toBe(before)
  })

  it('reverts every field the first save changed', async () => {
    const media = await createPhoto('revert')
    await database.applyMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 0,
      saveId: 'revert-save',
      recipe: RECIPE,
      render: render('revert-render', 600)
    })
    // A phase 2 mask, to show a revert frees it.
    await testDb.knex('media_edit_files').insert({
      id: crypto.randomUUID(),
      mediaId: Number(media.id),
      actorId: ACTOR1_ID,
      slot: 'mask:m1',
      path: 'medias/revert-mask.png',
      bytes: 50,
      mimeType: 'image/png',
      metaData: JSON.stringify({ width: 512, height: 384 }),
      createdAt: new Date()
    })
    await increaseCounterValue(testDb.db, CounterKey.mediaUsage(accountId), 50)
    const before = await usage()

    const result = await database.revertMediaEdit({
      mediaId: media.id,
      accountId,
      baseVersion: 1,
      saveId: 'revert-id'
    })

    expect(result).toMatchObject({
      status: 'ok',
      version: 2,
      removedPaths: ['medias/revert-mask.png']
    })
    const reverted = await database.getMediaByIdForAccount({
      mediaId: media.id,
      accountId
    })
    expect(reverted).toMatchObject({
      original: {
        path: 'medias/revert.webp',
        bytes: 1000,
        mimeType: 'image/jpeg',
        metaData: {
          width: 4000,
          height: 3000,
          upload: { state: 'verified', clientPath: 'uploads/revert.jpg' }
        }
      },
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: 0.25, y: -0.5 },
      edit: { version: 2, editedAt: null }
    })
    expect(reverted?.original.metaData).not.toHaveProperty('blurhash')
    expect(reverted?.original.metaData).not.toHaveProperty('focus')

    const state = await database.getMediaEditState({ mediaId: media.id })
    expect(state).toMatchObject({
      version: 2,
      recipe: null,
      editedAt: null,
      saveId: 'revert-id',
      original: null,
      masks: []
    })
    // The render stays until it is pruned: a post may still show it.
    expect(await slotsOf(media.id)).toEqual(['superseded'])
    expect(await usage()).toBe(before - 50)
  })

  it('answers not-edited for a photo with no original slot', async () => {
    const media = await createPhoto('not-edited')
    await expect(
      database.revertMediaEdit({
        mediaId: media.id,
        accountId,
        baseVersion: 0,
        saveId: 'nothing'
      })
    ).resolves.toEqual({ status: 'not-edited' })
  })

  it('answers not-found for another account and for an unknown id', async () => {
    const media = await createPhoto('not-owned')
    await expect(
      database.applyMediaEdit({
        mediaId: media.id,
        accountId: otherAccountId,
        baseVersion: 0,
        saveId: 'x',
        recipe: RECIPE,
        render: render('not-owned-render')
      })
    ).resolves.toEqual({ status: 'not-found' })
    await expect(
      database.revertMediaEdit({
        mediaId: '99999999',
        accountId,
        baseVersion: 0,
        saveId: 'x'
      })
    ).resolves.toEqual({ status: 'not-found' })
    await expect(
      database.pruneSupersededMediaEditFiles({
        mediaId: media.id,
        accountId: otherAccountId
      })
    ).resolves.toEqual([])
    expect(await slotsOf(media.id)).toEqual([])
  })

  it('prunes superseded renders, returning their paths and freeing their bytes', async () => {
    const media = await createPhoto('prune')
    for (const [index, name] of ['prune-a', 'prune-b', 'prune-c'].entries()) {
      await database.applyMediaEdit({
        mediaId: media.id,
        accountId,
        baseVersion: index,
        saveId: name,
        recipe: RECIPE,
        render: render(name, 100 * (index + 1))
      })
    }
    const before = await usage()

    const pruned = await database.pruneSupersededMediaEditFiles({
      mediaId: media.id,
      accountId
    })

    expect(pruned.sort()).toEqual([
      'medias/prune-a.webp',
      'medias/prune-b.webp'
    ])
    expect(await slotsOf(media.id)).toEqual(['original'])
    expect(await usage()).toBe(before - 300)
    await expect(
      database.pruneSupersededMediaEditFiles({ mediaId: media.id, accountId })
    ).resolves.toEqual([])
  })
})
