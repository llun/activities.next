import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'

describe('ServerSettingDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  afterAll(async () => {
    await Promise.all(table.map((item) => item[1].destroy()))
  })

  describe.each(table)('%s', (_, database) => {
    const read = async (key: string) =>
      (await database.getAllServerSettings()).find(
        (setting) => setting.key === key
      ) ?? null

    it('has no row for a setting that was never stored', async () => {
      await expect(read('missing.setting')).resolves.toBeNull()
    })

    it('stores and reads back a setting value', async () => {
      await database.setServerSettings([
        { key: 'posts.maxCharacters', value: 1000 }
      ])

      const stored = await read('posts.maxCharacters')
      expect(stored).toMatchObject({ key: 'posts.maxCharacters', value: 1000 })
      expect(stored?.createdAt).toBeGreaterThan(0)
      expect(stored?.updatedAt).toBeGreaterThan(0)
    })

    it('round-trips non-scalar JSON values', async () => {
      await database.setServerSettings([
        { key: 'instance.languages', value: ['en', 'th'] }
      ])

      const row = await read('instance.languages')
      expect(row?.value).toEqual(['en', 'th'])
    })

    it('upserts an existing key, overwriting value and keeping createdAt', async () => {
      await database.setServerSettings([
        { key: 'network.requestTimeoutMs', value: 4000 }
      ])
      const first = await read('network.requestTimeoutMs')
      await database.setServerSettings([
        { key: 'network.requestTimeoutMs', value: 8000 }
      ])
      const second = await read('network.requestTimeoutMs')

      expect(second?.value).toBe(8000)
      expect(second?.createdAt).toBe(first?.createdAt)
    })

    it('lists every stored setting ordered by key', async () => {
      await database.setServerSettings([
        { key: 'zeta.setting', value: 'z' },
        { key: 'alpha.setting', value: 'a' }
      ])

      const all = await database.getAllServerSettings()
      const keys = all.map((setting) => setting.key)
      const alphaIndex = keys.indexOf('alpha.setting')
      const zetaIndex = keys.indexOf('zeta.setting')

      expect(alphaIndex).toBeGreaterThanOrEqual(0)
      expect(zetaIndex).toBeGreaterThan(alphaIndex)
      expect([...keys]).toEqual([...keys].sort())
    })

    it('upserts a batch of settings in one call', async () => {
      await database.setServerSettings([
        { key: 'batch.one', value: 1 },
        { key: 'batch.two', value: ['a', 'b'] }
      ])

      await expect(read('batch.one')).resolves.toMatchObject({ value: 1 })
      await expect(read('batch.two')).resolves.toMatchObject({
        value: ['a', 'b']
      })

      // A second batch overwrites existing keys.
      await database.setServerSettings([{ key: 'batch.one', value: 2 }])
      await expect(read('batch.one')).resolves.toMatchObject({ value: 2 })
    })

    it('accepts an empty batch as a no-op', async () => {
      await expect(database.setServerSettings([])).resolves.toBeUndefined()
    })

    it('stores a boolean value distinctly from its string form', async () => {
      await database.setServerSettings([
        { key: 'registrations.open', value: false }
      ])

      const row = await read('registrations.open')
      expect(row?.value).toBe(false)
    })
  })
})
