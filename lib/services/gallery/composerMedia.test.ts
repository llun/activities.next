import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  getComposerPrefillAttachments,
  parseComposerMediaParam
} from '@/lib/services/gallery/composerMedia'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('parseComposerMediaParam', () => {
  it('reads the ids in order, without repeats', () => {
    expect(parseComposerMediaParam('12,3,12,7', 10)).toEqual(['12', '3', '7'])
  })

  it('drops anything that is not a decimal id', () => {
    expect(
      parseComposerMediaParam(' 4 ,x,5;6,,-1,1.5,0x10,12345678901,../etc,7', 10)
    ).toEqual(['4', '7'])
  })

  it('stops at the limit', () => {
    expect(parseComposerMediaParam('1,2,3,4,5', 3)).toEqual(['1', '2', '3'])
    expect(parseComposerMediaParam('1,2', 0)).toEqual([])
  })

  it('joins a repeated parameter and tolerates a missing one', () => {
    expect(parseComposerMediaParam(['1,2', '3'], 10)).toEqual(['1', '2', '3'])
    expect(parseComposerMediaParam(undefined, 10)).toEqual([])
    expect(parseComposerMediaParam('', 10)).toEqual([])
  })
})

describe('getComposerPrefillAttachments', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    const ownerId = actors.empty.id
    const otherId = actors.extra.id
    const ids: Record<string, string> = {}

    const createMedia = async (
      name: string,
      actorId: string,
      extra: { description?: string; pending?: boolean; poster?: boolean } = {}
    ) => {
      const media = await database.createMedia({
        actorId,
        original: {
          path: `/test/composer-${name}.jpg`,
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: {
            width: 640,
            height: 480,
            ...(extra.pending ? { upload: { state: 'pending' } } : {})
          } as never
        },
        ...(extra.poster
          ? {
              thumbnail: {
                path: `/test/composer-${name}-thumb.jpg`,
                bytes: 10,
                mimeType: 'image/jpeg',
                metaData: { width: 64, height: 48 }
              }
            }
          : {}),
        description: extra.description
      })
      ids[name] = media!.id
      return media!
    }

    beforeAll(async () => {
      await seedDatabase(database)
      await createMedia('mine', ownerId, { description: 'A heron' })
      await createMedia('bare', ownerId)
      await createMedia('poster', ownerId, { poster: true })
      await createMedia('theirs', otherId)
      await createMedia('pending', ownerId, { pending: true })
      const posted = await createMedia('posted', ownerId)
      await database.createAttachment({
        actorId: ownerId,
        statusId: `${ownerId}/statuses/composer-posted`,
        mediaType: 'image/jpeg',
        url: 'https://media.test/composer-posted.jpg',
        width: 640,
        height: 480,
        mediaId: posted.id
      })
    })

    const prefill = (names: string[]) =>
      getComposerPrefillAttachments({
        database,
        actorId: ownerId,
        mediaIds: names.map((name) => ids[name] ?? name)
      })

    it('builds an attachment for each of the actor’s unposted uploads', async () => {
      const result = await prefill(['mine', 'bare'])

      expect(result.map((attachment) => attachment.id)).toEqual([
        ids.mine,
        ids.bare
      ])
      expect(result[0]).toMatchObject({
        type: 'upload',
        mediaType: 'image/jpeg',
        width: 640,
        height: 480,
        name: 'A heron'
      })
      expect(result[0].url).toContain('composer-mine.jpg')
      expect(result[1]).not.toHaveProperty('name')
    })

    it('carries the poster of a video-like upload', async () => {
      const [attachment] = await prefill(['poster'])
      expect(attachment.posterUrl).toContain('composer-poster-thumb.jpg')
    })

    it('keeps the order of the ids it was given', async () => {
      const result = await prefill(['bare', 'mine'])
      expect(result.map((attachment) => attachment.id)).toEqual([
        ids.bare,
        ids.mine
      ])
    })

    it('ignores somebody else’s media, posted media, unfinished uploads and unknown ids', async () => {
      const result = await prefill([
        'theirs',
        'posted',
        'pending',
        '99999999',
        'mine'
      ])
      expect(result.map((attachment) => attachment.id)).toEqual([ids.mine])
    })

    it('does nothing for no ids', async () => {
      expect(await prefill([])).toEqual([])
    })
  })
})
