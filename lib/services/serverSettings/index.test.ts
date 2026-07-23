import { DEFAULT_SERVER_SETTINGS } from '@/lib/config/serverSettings'
import { getTestSQLDatabase } from '@/lib/database/testUtils'
import {
  getResolvedServerSettings,
  getServerSettingsView,
  invalidateServerSettingsCache,
  updateServerSettings
} from '@/lib/services/serverSettings'

const ENV_KEYS = [
  'ACTIVITIES_SERVICE_NAME',
  'ACTIVITIES_SERVICE_DESCRIPTION',
  'ACTIVITIES_LANGUAGES',
  'ACTIVITIES_REGISTRATION_OPEN',
  'ACTIVITIES_ALLOW_EMAILS',
  'ACTIVITIES_MEDIA_STORAGE_MAX_FILE_SIZE',
  'ACTIVITIES_REQUEST_TIMEOUT',
  'ACTIVITIES_REQUEST_RETRY',
  'ACTIVITIES_REQUEST_MAX_RESPONSE_SIZE_BYTES',
  'ACTIVITIES_FEDERATION_MODE',
  'ACTIVITIES_ALLOW_ACTOR_DOMAINS'
]

const freshDatabase = async () => {
  const database = getTestSQLDatabase()
  await database.migrate()
  return database
}

describe('server settings resolver', () => {
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it('returns registry defaults with no env and no stored rows', async () => {
    const database = await freshDatabase()
    await expect(getResolvedServerSettings(database)).resolves.toEqual(
      DEFAULT_SERVER_SETTINGS
    )
    await database.destroy()
  })

  it('serves a stored database value over the default', async () => {
    const database = await freshDatabase()
    await database.setServerSetting({ key: 'posts.maxCharacters', value: 1000 })
    invalidateServerSettingsCache(database)

    const settings = await getResolvedServerSettings(database)
    expect(settings.posts.maxCharacters).toBe(1000)
    await database.destroy()
  })

  it('lets an env override win over a stored value and locks the field', async () => {
    const database = await freshDatabase()
    await database.setServerSetting({ key: 'instance.name', value: 'DB Name' })
    process.env.ACTIVITIES_SERVICE_NAME = 'Env Name'
    invalidateServerSettingsCache(database)

    const view = await getServerSettingsView(database)
    expect(view.settings.instance.name).toBe('Env Name')
    expect(view.locks['instance.name']).toEqual({
      locked: true,
      envVar: 'ACTIVITIES_SERVICE_NAME'
    })
    await database.destroy()
  })

  it('marks fields without an env override as unlocked', async () => {
    const database = await freshDatabase()
    const view = await getServerSettingsView(database)
    expect(view.locks['instance.name'].locked).toBe(false)
    expect(view.locks['posts.maxCharacters'].locked).toBe(false)
    await database.destroy()
  })

  it('ignores an invalid stored value and falls back to the default', async () => {
    const database = await freshDatabase()
    await database.setServerSetting({ key: 'posts.maxCharacters', value: -5 })
    invalidateServerSettingsCache(database)

    const settings = await getResolvedServerSettings(database)
    expect(settings.posts.maxCharacters).toBe(
      DEFAULT_SERVER_SETTINGS.posts.maxCharacters
    )
    await database.destroy()
  })

  it('parses env values the way getConfig does', async () => {
    const database = await freshDatabase()
    process.env.ACTIVITIES_REGISTRATION_OPEN = 'false'
    process.env.ACTIVITIES_LANGUAGES = '["en","th"]'
    process.env.ACTIVITIES_ALLOW_EMAILS = '["A@Example.com"]'
    process.env.ACTIVITIES_FEDERATION_MODE = 'allowlist'
    process.env.ACTIVITIES_REQUEST_TIMEOUT = '8000'
    invalidateServerSettingsCache(database)

    const settings = await getResolvedServerSettings(database)
    expect(settings.registrations.open).toBe(false)
    expect(settings.instance.languages).toEqual(['en', 'th'])
    expect(settings.registrations.allowEmails).toEqual(['a@example.com'])
    expect(settings.federation.mode).toBe('allowlist')
    expect(settings.network.requestTimeoutMs).toBe(8000)
    await database.destroy()
  })

  it('caches within the TTL and re-reads after invalidation', async () => {
    const database = await freshDatabase()
    const spy = vi.spyOn(database, 'getAllServerSettings')

    await getResolvedServerSettings(database)
    await getResolvedServerSettings(database)
    expect(spy).toHaveBeenCalledTimes(1)

    invalidateServerSettingsCache(database)
    await getResolvedServerSettings(database)
    expect(spy).toHaveBeenCalledTimes(2)

    spy.mockRestore()
    await database.destroy()
  })

  it('re-reads the database after the cache TTL expires', async () => {
    const database = await freshDatabase()
    const spy = vi.spyOn(database, 'getAllServerSettings')

    await getResolvedServerSettings(database)
    await getResolvedServerSettings(database)
    expect(spy).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(60_000)
      await getResolvedServerSettings(database)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
    spy.mockRestore()
    await database.destroy()
  })

  it('falls back to env + defaults when the settings read fails with no prior cache', async () => {
    const database = await freshDatabase()
    const spy = vi
      .spyOn(database, 'getAllServerSettings')
      .mockRejectedValue(new Error('database unavailable'))
    process.env.ACTIVITIES_SERVICE_NAME = 'Env Name'
    invalidateServerSettingsCache(database)

    const settings = await getResolvedServerSettings(database)
    // Env override still applies; everything else is the registry default.
    expect(settings.instance.name).toBe('Env Name')
    expect(settings.registrations.open).toBe(
      DEFAULT_SERVER_SETTINGS.registrations.open
    )

    spy.mockRestore()
    await database.destroy()
  })

  it('keeps serving the last-known-good stored value when a later read fails', async () => {
    const database = await freshDatabase()
    await database.setServerSetting({ key: 'registrations.open', value: false })
    invalidateServerSettingsCache(database)
    // Prime the cache with the stored (closed) value.
    await expect(getResolvedServerSettings(database)).resolves.toMatchObject({
      registrations: { open: false }
    })

    vi.useFakeTimers()
    try {
      // Expire the cache, then make the re-read fail.
      vi.advanceTimersByTime(60_000)
      const spy = vi
        .spyOn(database, 'getAllServerSettings')
        .mockRejectedValue(new Error('database unavailable'))

      // Must serve the stale stored value (closed), not revert to the
      // permissive default (open).
      const settings = await getResolvedServerSettings(database)
      expect(settings.registrations.open).toBe(false)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
    await database.destroy()
  })

  describe('updateServerSettings', () => {
    it('writes valid values and reflects them immediately', async () => {
      const database = await freshDatabase()
      const result = await updateServerSettings(database, {
        'posts.maxCharacters': 2000,
        'network.requestRetries': 3
      })

      expect(result.applied).toBe(true)
      expect(result.rejected).toEqual([])
      expect(result.view.settings.posts.maxCharacters).toBe(2000)
      expect(result.view.settings.network.requestRetries).toBe(3)
      await database.destroy()
    })

    it('rejects the whole patch when a key is env-locked and writes nothing', async () => {
      const database = await freshDatabase()
      process.env.ACTIVITIES_SERVICE_NAME = 'Env Name'
      invalidateServerSettingsCache(database)

      const result = await updateServerSettings(database, {
        'instance.name': 'Should Not Save',
        'posts.maxCharacters': 900
      })

      expect(result.applied).toBe(false)
      expect(result.rejected).toContainEqual({
        key: 'instance.name',
        reason: 'locked'
      })

      invalidateServerSettingsCache(database)
      const settings = await getResolvedServerSettings(database)
      expect(settings.posts.maxCharacters).toBe(
        DEFAULT_SERVER_SETTINGS.posts.maxCharacters
      )
      await database.destroy()
    })

    it('rejects unknown keys and invalid values', async () => {
      const database = await freshDatabase()
      const result = await updateServerSettings(database, {
        'nope.key': 1,
        'posts.maxCharacters': -3
      })

      expect(result.applied).toBe(false)
      expect(result.rejected).toEqual(
        expect.arrayContaining([
          { key: 'nope.key', reason: 'unknown' },
          { key: 'posts.maxCharacters', reason: 'invalid' }
        ])
      )
      await database.destroy()
    })

    it('normalizes allowed emails on write', async () => {
      const database = await freshDatabase()
      const result = await updateServerSettings(database, {
        'registrations.allowEmails': ['User@Example.COM', ' second@x.test ']
      })

      expect(result.applied).toBe(true)
      expect(result.view.settings.registrations.allowEmails).toEqual([
        'user@example.com',
        'second@x.test'
      ])
      await database.destroy()
    })
  })
})
