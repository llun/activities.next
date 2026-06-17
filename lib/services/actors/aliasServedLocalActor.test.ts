import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

import { aliasServedLocalActor } from './aliasServedLocalActor'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

const actorRow = (username: string, domain: string, local: boolean) => ({
  id: `https://${domain}/users/${username}`,
  username,
  domain,
  type: 'Person',
  // A local actor is one this instance owns: it has a private key.
  privateKey: local ? 'private-key' : ''
})

const databaseWith = (
  rows: { username: string; domain: string; local: boolean }[]
) =>
  ({
    getActorFromUsername: vi.fn(
      async ({ username, domain }: { username: string; domain: string }) => {
        const match = rows.find(
          (row) => row.username === username && row.domain === domain
        )
        return match
          ? actorRow(match.username, match.domain, match.local)
          : null
      }
    )
  }) as unknown as Database

// A case-insensitive backend (e.g. a citext column): any casing of the queried
// domain returns the single stored row, with the row's STORED casing/id.
const caseInsensitiveDatabaseWith = (
  rows: { username: string; domain: string; local: boolean }[]
) =>
  ({
    getActorFromUsername: vi.fn(
      async ({ username, domain }: { username: string; domain: string }) => {
        const match = rows.find(
          (row) =>
            row.username === username &&
            row.domain.toLowerCase() === domain.toLowerCase()
        )
        return match
          ? actorRow(match.username, match.domain, match.local)
          : null
      }
    )
  }) as unknown as Database

describe('aliasServedLocalActor', () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'canonical.example',
      trustedHosts: ['alias.example']
    } as ReturnType<typeof getConfig>)
  })

  it('resolves a trusted-host alias to the canonical local actor', async () => {
    const database = databaseWith([
      { username: 'alice', domain: 'canonical.example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'alias.example'
    })

    expect(actor?.id).toBe('https://canonical.example/users/alice')
    expect(actor?.domain).toBe('canonical.example')
  })

  it('does not alias a domain the instance does not serve', async () => {
    const database = databaseWith([
      { username: 'alice', domain: 'canonical.example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'evil.example'
    })

    expect(actor).toBeNull()
  })

  it('returns null when no local actor owns the username on a served host', async () => {
    // Only a remote (no private key) row exists — never alias to it.
    const database = databaseWith([
      { username: 'alice', domain: 'canonical.example', local: false }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'alias.example'
    })

    expect(actor).toBeNull()
  })

  it('resolves to a local actor stored on another served host when queried by the canonical host', async () => {
    // Host-rename scenario: the queried domain is the canonical host, but the
    // local actor row still lives under a previously-served (now alias) host.
    const database = databaseWith([
      { username: 'alice', domain: 'alias.example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'canonical.example'
    })

    expect(actor?.id).toBe('https://alias.example/users/alice')
    expect(actor?.domain).toBe('alias.example')
  })

  it('resolves an actor stored under the as-configured mixed-case host on a case-sensitive database', async () => {
    // Mixed-case ACTIVITIES_HOST: the local actor row is stored under the exact
    // configured casing, and PostgreSQL/SQLite match `domain` case-sensitively.
    // A lowercase-only lookup would miss it.
    vi.mocked(getConfig).mockReturnValue({
      host: 'Canonical.Example',
      trustedHosts: ['alias.example']
    } as ReturnType<typeof getConfig>)
    const database = databaseWith([
      { username: 'alice', domain: 'Canonical.Example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'alias.example'
    })

    expect(actor?.domain).toBe('Canonical.Example')
  })

  it('does not treat case-insensitive duplicate matches as ambiguous', async () => {
    // On a case-insensitive backend both casing variants of the canonical host
    // return the same actor row; that must resolve, not register as ambiguous.
    vi.mocked(getConfig).mockReturnValue({
      host: 'Canonical.Example',
      trustedHosts: ['alias.example']
    } as ReturnType<typeof getConfig>)
    const database = caseInsensitiveDatabaseWith([
      { username: 'alice', domain: 'Canonical.Example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'alias.example'
    })

    expect(actor?.id).toBe('https://Canonical.Example/users/alice')
  })

  it('does not alias when the username is ambiguous across served hosts', async () => {
    vi.mocked(getConfig).mockReturnValue({
      host: 'canonical.example',
      trustedHosts: ['alias.example', 'third.example']
    } as ReturnType<typeof getConfig>)
    const database = databaseWith([
      { username: 'alice', domain: 'canonical.example', local: true },
      { username: 'alice', domain: 'alias.example', local: true }
    ])

    const actor = await aliasServedLocalActor({
      database,
      username: 'alice',
      domain: 'third.example'
    })

    expect(actor).toBeNull()
  })
})
