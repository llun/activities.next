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
    it('returns null for a setting that was never stored', async () => {
      await expect(
        database.getServerSetting({ key: 'missing.setting' })
      ).resolves.toBeNull()
    })

    it('stores and reads back a setting value', async () => {
      const stored = await database.setServerSetting({
        key: 'posts.maxCharacters',
        value: 1000
      })

      expect(stored).toMatchObject({ key: 'posts.maxCharacters', value: 1000 })
      expect(stored.createdAt).toBeGreaterThan(0)
      expect(stored.updatedAt).toBeGreaterThan(0)

      await expect(
        database.getServerSetting({ key: 'posts.maxCharacters' })
      ).resolves.toMatchObject({ key: 'posts.maxCharacters', value: 1000 })
    })

    it('round-trips non-scalar JSON values', async () => {
      await database.setServerSetting({
        key: 'instance.languages',
        value: ['en', 'th']
      })

      const row = await database.getServerSetting({ key: 'instance.languages' })
      expect(row?.value).toEqual(['en', 'th'])
    })

    it('upserts an existing key, overwriting value and keeping createdAt', async () => {
      const first = await database.setServerSetting({
        key: 'network.requestTimeoutMs',
        value: 4000
      })
      const second = await database.setServerSetting({
        key: 'network.requestTimeoutMs',
        value: 8000
      })

      expect(second.value).toBe(8000)
      expect(second.createdAt).toBe(first.createdAt)
      await expect(
        database.getServerSetting({ key: 'network.requestTimeoutMs' })
      ).resolves.toMatchObject({ value: 8000 })
    })

    it('lists every stored setting ordered by key', async () => {
      await database.setServerSetting({ key: 'zeta.setting', value: 'z' })
      await database.setServerSetting({ key: 'alpha.setting', value: 'a' })

      const all = await database.getAllServerSettings()
      const keys = all.map((setting) => setting.key)
      const alphaIndex = keys.indexOf('alpha.setting')
      const zetaIndex = keys.indexOf('zeta.setting')

      expect(alphaIndex).toBeGreaterThanOrEqual(0)
      expect(zetaIndex).toBeGreaterThan(alphaIndex)
      expect([...keys]).toEqual([...keys].sort())
    })

    it('deletes a stored setting and reports removal', async () => {
      await database.setServerSetting({
        key: 'federation.mode',
        value: 'allowlist'
      })

      await expect(
        database.deleteServerSetting({ key: 'federation.mode' })
      ).resolves.toBe(true)
      await expect(
        database.getServerSetting({ key: 'federation.mode' })
      ).resolves.toBeNull()
    })

    it('returns false when deleting a key that does not exist', async () => {
      await expect(
        database.deleteServerSetting({ key: 'never.stored' })
      ).resolves.toBe(false)
    })

    it('upserts a batch of settings in one call', async () => {
      await database.setServerSettings([
        { key: 'batch.one', value: 1 },
        { key: 'batch.two', value: ['a', 'b'] }
      ])

      await expect(
        database.getServerSetting({ key: 'batch.one' })
      ).resolves.toMatchObject({ value: 1 })
      await expect(
        database.getServerSetting({ key: 'batch.two' })
      ).resolves.toMatchObject({ value: ['a', 'b'] })

      // A second batch overwrites existing keys.
      await database.setServerSettings([{ key: 'batch.one', value: 2 }])
      await expect(
        database.getServerSetting({ key: 'batch.one' })
      ).resolves.toMatchObject({ value: 2 })
    })

    it('accepts an empty batch as a no-op', async () => {
      await expect(database.setServerSettings([])).resolves.toBeUndefined()
    })

    it('stores a boolean value distinctly from its string form', async () => {
      await database.setServerSetting({
        key: 'registrations.open',
        value: false
      })

      const row = await database.getServerSetting({ key: 'registrations.open' })
      expect(row?.value).toBe(false)
    })
  })
})
