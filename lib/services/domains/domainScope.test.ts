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
    await database.createServedDomain({ domain: 'run.example' })
  })

  afterAll(async () => {
    await database.destroy()
  })

  const resolve = (raw: string | null | undefined, allowPrimary = false) =>
    resolveAdminDomainScope(database, raw, { allowPrimary })

  it.each([null, undefined, '', '   '])(
    'reads %j as every domain',
    async (raw) => {
      await expect(resolve(raw)).resolves.toEqual({ type: 'ok', domain: null })
    }
  )

  it('accepts the env domains and the added rows, on or off, normalised', async () => {
    await expect(resolve('Club.Example')).resolves.toEqual({
      type: 'ok',
      domain: 'club.example'
    })
    await expect(resolve('run.example')).resolves.toEqual({
      type: 'ok',
      domain: 'run.example'
    })
  })

  it('takes the primary only where the scope allows it', async () => {
    await expect(resolve('social.example')).resolves.toEqual({
      type: 'primary'
    })
    await expect(resolve('social.example', true)).resolves.toEqual({
      type: 'ok',
      domain: 'social.example'
    })
  })

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
