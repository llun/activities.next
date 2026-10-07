import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  appendSubjectHashtags,
  toSubjectHashtag
} from '@/lib/services/gallery/subjectHashtags'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('toSubjectHashtag', () => {
  it.each([
    ['Common Kingfisher', 'CommonKingfisher'],
    ['Eurasian Eagle-Owl', 'EurasianEagleOwl'],
    ['  red   fox ', 'RedFox'],
    ['McCown’s Longspur', 'McCownSLongspur'],
    ['GREAT TIT', 'GreatTit'],
    ['Côte d’Azur Gull', 'CoteDAzurGull'],
    ['Pied Wagtail 2', 'PiedWagtail2'],
    ['Kingfisher', 'Kingfisher']
  ])('turns %j into #%s', (name, expected) => {
    expect(toSubjectHashtag(name)).toBe(expected)
  })

  it.each([
    ['', 'an empty name'],
    ['カワセミ', 'a name the hashtag grammar cannot hold'],
    ['1234', 'digits only (a hashtag needs a letter)'],
    ['---', 'punctuation only']
  ])('returns null for %j (%s)', (name) => {
    expect(toSubjectHashtag(name)).toBeNull()
  })

  it('caps very long names', () => {
    expect(toSubjectHashtag('word '.repeat(100))?.length).toBeLessThanOrEqual(
      100
    )
  })
})

describe('appendSubjectHashtags', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    let accountId: string

    beforeAll(async () => {
      await seedDatabase(database)
      const actor = await database.getActorFromId({ id: actors.primary.id })
      accountId = actor!.account!.id
    })

    afterAll(async () => {
      await database.destroy()
    })

    beforeEach(async () => {
      await database.updateGallerySettings({
        actorId: actors.primary.id,
        subjectHashtags: true
      })
    })

    const createMedia = async (subjectName: string | null) => {
      const media = await database.createMedia({
        actorId: actors.primary.id,
        original: {
          path: `/test/hashtag-${Math.random()}.jpg`,
          bytes: 100,
          mimeType: 'image/jpeg',
          metaData: { width: 10, height: 10 }
        },
        ...(subjectName ? { details: { subjectName } } : {})
      })
      return media!.id
    }

    const append = (text: string, mediaIds: string[]) =>
      appendSubjectHashtags({ database, accountId, text, mediaIds })

    it('appends a PascalCase hashtag for an attached subject', async () => {
      const id = await createMedia('Common Kingfisher')

      expect(await append('Look at this', [id])).toBe(
        'Look at this\n\n#CommonKingfisher'
      )
    })

    it('appends in attachment order, one tag per distinct subject', async () => {
      const heron = await createMedia('Grey Heron')
      const otter = await createMedia('Otter')
      const heronAgain = await createMedia('grey heron')

      expect(await append('Morning', [otter, heron, heronAgain])).toBe(
        'Morning\n\n#Otter #GreyHeron'
      )
    })

    it('writes just the tags for a post with no text', async () => {
      const id = await createMedia('Red Fox')

      expect(await append('', [id])).toBe('#RedFox')
      expect(await append('  \n', [id])).toBe('#RedFox')
    })

    it('does not repeat a tag the text already has, whatever its case', async () => {
      const id = await createMedia('Common Kingfisher')

      expect(await append('Found a #commonkingfisher today', [id])).toBe(
        'Found a #commonkingfisher today'
      )
    })

    it('does nothing when the owner turned subject hashtags off', async () => {
      await database.updateGallerySettings({
        actorId: actors.primary.id,
        subjectHashtags: false
      })
      const id = await createMedia('Common Kingfisher')

      expect(await append('Look', [id])).toBe('Look')
    })

    it.each([
      ['no attachments', () => []],
      ['an attachment with no subject', async () => [await createMedia(null)]],
      ['an unknown media id', () => ['999999999']],
      [
        'a subject the grammar cannot hold',
        async () => [await createMedia('カワセミ')]
      ]
    ])('leaves the text alone for %s', async (_, getIds) => {
      expect(await append('Hello', await getIds())).toBe('Hello')
    })

    it('ignores media that belongs to another account', async () => {
      const id = await createMedia('Common Kingfisher')

      expect(
        await appendSubjectHashtags({
          database,
          accountId: 'someone-else',
          text: 'Hello',
          mediaIds: [id]
        })
      ).toBe('Hello')
      expect(
        await appendSubjectHashtags({
          database,
          accountId: undefined,
          text: 'Hello',
          mediaIds: [id]
        })
      ).toBe('Hello')
    })
  })

  it('leaves the text alone when the lookup fails', async () => {
    const database = {
      getMediaByIdsForAccount: vi.fn().mockRejectedValue(new Error('down'))
    }

    expect(
      await appendSubjectHashtags({
        database: database as never,
        accountId: 'account',
        text: 'Hello',
        mediaIds: ['1']
      })
    ).toBe('Hello')
  })
})
