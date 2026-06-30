import { getTestSQLDatabase } from '@/lib/database/testUtils'

describe('StatusDetectedLanguage', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('returns null when no detected language has been recorded', async () => {
    const language = await database.getDetectedLanguage({
      statusId: 'status-missing'
    })
    expect(language).toBeNull()
  })

  it('round-trips a set detected language', async () => {
    await database.setDetectedLanguage({
      statusId: 'status-a',
      language: 'th',
      confidence: 0.97
    })

    const language = await database.getDetectedLanguage({
      statusId: 'status-a'
    })
    expect(language).toBe('th')
  })

  it('upserts on conflict, overwriting the previous value', async () => {
    await database.setDetectedLanguage({
      statusId: 'status-b',
      language: 'en',
      confidence: 0.8
    })
    await database.setDetectedLanguage({
      statusId: 'status-b',
      language: 'fr',
      confidence: 0.9
    })

    const language = await database.getDetectedLanguage({
      statusId: 'status-b'
    })
    expect(language).toBe('fr')
  })

  it('defaults confidence to null when omitted', async () => {
    await database.setDetectedLanguage({
      statusId: 'status-c',
      language: 'ja'
    })

    const language = await database.getDetectedLanguage({
      statusId: 'status-c'
    })
    expect(language).toBe('ja')
  })

  describe('clearDetectedLanguage', () => {
    it('removes a previously recorded detected language', async () => {
      await database.setDetectedLanguage({
        statusId: 'status-clear',
        language: 'th'
      })
      expect(
        await database.getDetectedLanguage({ statusId: 'status-clear' })
      ).toBe('th')

      await database.clearDetectedLanguage({ statusId: 'status-clear' })

      expect(
        await database.getDetectedLanguage({ statusId: 'status-clear' })
      ).toBeNull()
    })

    it('is a no-op when there is nothing to clear', async () => {
      await expect(
        database.clearDetectedLanguage({ statusId: 'status-never-set' })
      ).resolves.toBeUndefined()
    })
  })

  describe('getDetectedLanguages', () => {
    it('returns an empty object for an empty statusIds array', async () => {
      const result = await database.getDetectedLanguages({ statusIds: [] })
      expect(result).toEqual({})
    })

    it('maps only the statusIds that have a recorded language', async () => {
      await database.setDetectedLanguage({
        statusId: 'status-d',
        language: 'th'
      })
      await database.setDetectedLanguage({
        statusId: 'status-e',
        language: 'en'
      })

      const result = await database.getDetectedLanguages({
        statusIds: ['status-d', 'status-e', 'status-missing-from-batch']
      })
      expect(result).toEqual({ 'status-d': 'th', 'status-e': 'en' })
    })
  })
})
