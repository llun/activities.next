import { publishPlaceLookup, publishSubjectLookup } from './publishLookups'

const mockPublish = vi.fn()
vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({
    runsInline: false,
    publish: (...args: unknown[]) => mockPublish(...args)
  })
}))

const subject = {
  mediaId: '7',
  subjectName: 'Common Kingfisher',
  subjectScientificName: 'Alcedo atthis',
  subjectCategory: 'bird',
  subjectTaxonKey: null
}

const idOf = () => mockPublish.mock.calls.at(-1)?.[0].id as string

describe('publishLookups', () => {
  beforeEach(() => {
    mockPublish.mockReset()
    mockPublish.mockResolvedValue(undefined)
  })

  describe('publishPlaceLookup', () => {
    it('derives the id from the media and the coordinates', async () => {
      const publish = async (mediaId: string, latitude: number) => {
        await publishPlaceLookup({ mediaId, latitude, longitude: 101.4 })
        return idOf()
      }

      const same = await publish('7', 14.5)
      expect(await publish('7', 14.5)).toBe(same)
      expect(await publish('7', 14.6)).not.toBe(same)
      expect(await publish('8', 14.5)).not.toBe(same)
    })

    it('tells the job about a retry', async () => {
      await publishPlaceLookup({
        mediaId: '7',
        latitude: 1,
        longitude: 2,
        fresh: true,
        retry: true
      })
      expect(mockPublish.mock.calls[0][0].data).toEqual({
        mediaId: '7',
        retry: true
      })
    })
  })

  describe('publishSubjectLookup', () => {
    it('derives the id from the media and every subject field', async () => {
      await publishSubjectLookup(subject)
      const base = idOf()

      await publishSubjectLookup(subject)
      expect(idOf()).toBe(base)

      for (const change of [
        { subjectName: 'Otter' },
        { subjectScientificName: null },
        { subjectCategory: 'mammal' },
        { subjectTaxonKey: '2475532' },
        { mediaId: '8' }
      ]) {
        await publishSubjectLookup({ ...subject, ...change })
        expect(idOf()).not.toBe(base)
      }
    })

    it('uses a new id for each fresh publish of the same subject', async () => {
      await publishSubjectLookup({ ...subject, fresh: true })
      const first = idOf()
      await publishSubjectLookup({ ...subject, fresh: true })
      expect(idOf()).not.toBe(first)

      await publishSubjectLookup({ ...subject, fresh: true, retry: true })
      expect(mockPublish.mock.calls.at(-1)?.[0].data).toEqual({
        mediaId: '7',
        retry: true
      })
    })

    it('does not confuse fields that join to the same text', async () => {
      await publishSubjectLookup({
        ...subject,
        subjectName: 'a|b',
        subjectScientificName: 'c'
      })
      const first = idOf()
      await publishSubjectLookup({
        ...subject,
        subjectName: 'a',
        subjectScientificName: 'b|c'
      })

      expect(idOf()).not.toBe(first)
    })
  })
})
