import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

import { resolveAdminDomainScope } from './domainScope'

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: 'social.example',
    allowEmails: [],
    trustedHosts: ['club.example', '*.preview.example'],
    secretPhase: 'secret'
  })
}))

describe('resolveAdminDomainScope', () => {
  let database: Database

  beforeAll(async () => {
    database = getTestSQLDatabase()
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  const resolve = (raw: string | null | undefined, allowPrimary = false) =>
    resolveAdminDomainScope(database, raw, { allowPrimary })

  it('refuses unserved domains, wildcard hosts and non-domains', async () => {
    await expect(resolve('nowhere.example')).resolves.toEqual({
      type: 'unknown'
    })
    await expect(resolve('pr-1.preview.example')).resolves.toEqual({
      type: 'unknown'
    })
    await expect(resolve('*.preview.example')).resolves.toEqual({
      type: 'invalid'
    })
    await expect(resolve('a b/c')).resolves.toEqual({ type: 'invalid' })
  })
})
