import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import * as remoteSignatureSchemeMigration from '@/migrations/20261106094910_add_remote_signature_schemes'

describe('remoteSignatureScheme database domain', () => {
  const { database, db, prepare, destroy } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
  })

  afterAll(async () => {
    await destroy()
  })

  beforeEach(async () => {
    await db.deleteFrom('remote_signature_schemes').execute()
  })

  it('returns null for unknown, invalid, or overlong hosts', async () => {
    const now = Date.parse('2026-11-06T09:00:00.000Z')
    expect(
      await database.getRemoteSignatureScheme({
        domain: 'missing.example',
        now
      })
    ).toBeNull()
    expect(
      await database.getRemoteSignatureScheme({ domain: '   ', now })
    ).toBeNull()
    expect(
      await database.getRemoteSignatureScheme({
        domain: 'bad/host.example',
        now
      })
    ).toBeNull()
    expect(
      await database.getRemoteSignatureScheme({
        domain: `${'a'.repeat(250)}.example`,
        now
      })
    ).toBeNull()
  })

  it('normalizes hosts on write and read, dropping :443 and keeping custom ports', async () => {
    const t0 = Date.parse('2026-11-06T09:00:00.000Z')
    const expiresAt = t0 + 7 * 24 * 60 * 60 * 1000

    await database.upsertRemoteSignatureScheme({
      domain: '  Peer.Example.:443 ',
      scheme: 'rfc9421',
      expiresAt,
      now: t0
    })
    await database.upsertRemoteSignatureScheme({
      domain: 'Peer.Example:8443',
      scheme: 'cavage',
      expiresAt,
      now: t0
    })

    const defaultPort = await database.getRemoteSignatureScheme({
      domain: 'peer.example',
      now: t0 + 1000
    })
    expect(defaultPort).toEqual({
      domain: 'peer.example',
      scheme: 'rfc9421',
      expiresAt,
      createdAt: t0,
      updatedAt: t0
    })

    const customPort = await database.getRemoteSignatureScheme({
      domain: 'peer.example:8443',
      now: t0 + 1000
    })
    expect(customPort).toEqual({
      domain: 'peer.example:8443',
      scheme: 'cavage',
      expiresAt,
      createdAt: t0,
      updatedAt: t0
    })
  })

  it('upserts an existing domain, updating scheme, expiresAt, and updatedAt while keeping createdAt', async () => {
    const t1 = Date.parse('2026-11-06T09:00:00.000Z')
    const t2 = Date.parse('2026-11-07T12:00:00.000Z')
    const exp1 = t1 + 86_400_000
    const exp2 = t2 + 7 * 86_400_000

    await database.upsertRemoteSignatureScheme({
      domain: 'flip.example',
      scheme: 'rfc9421',
      expiresAt: exp1,
      now: t1
    })
    await database.upsertRemoteSignatureScheme({
      domain: 'FLIP.EXAMPLE',
      scheme: 'cavage',
      expiresAt: exp2,
      now: t2
    })

    const entry = await database.getRemoteSignatureScheme({
      domain: 'flip.example',
      now: t2
    })
    expect(entry).toEqual({
      domain: 'flip.example',
      scheme: 'cavage',
      expiresAt: exp2,
      createdAt: t1,
      updatedAt: t2
    })
  })

  it('treats expired rows and unknown stored scheme values as null', async () => {
    const t0 = Date.parse('2026-11-06T09:00:00.000Z')
    const expiresAt = t0 + 60_000

    await database.upsertRemoteSignatureScheme({
      domain: 'expiring.example',
      scheme: 'rfc9421',
      expiresAt,
      now: t0
    })

    expect(
      await database.getRemoteSignatureScheme({
        domain: 'expiring.example',
        now: expiresAt - 1
      })
    ).toMatchObject({ scheme: 'rfc9421' })
    expect(
      await database.getRemoteSignatureScheme({
        domain: 'expiring.example',
        now: expiresAt
      })
    ).toBeNull()
    expect(
      await database.getRemoteSignatureScheme({
        domain: 'expiring.example',
        now: expiresAt + 1
      })
    ).toBeNull()

    await db
      .insertInto('remote_signature_schemes')
      .values({
        domain: 'corrupt.example',
        scheme: 'ed25519-custom',
        expiresAt: new Date(expiresAt),
        createdAt: new Date(t0),
        updatedAt: new Date(t0)
      })
      .execute()
    expect(
      await database.getRemoteSignatureScheme({
        domain: 'corrupt.example',
        now: t0
      })
    ).toBeNull()
  })

  it('deletes expired rows both unbounded and with a batch limit', async () => {
    const t0 = Date.parse('2026-11-06T09:00:00.000Z')
    await database.upsertRemoteSignatureScheme({
      domain: 'old-1.example',
      scheme: 'rfc9421',
      expiresAt: t0 + 1000,
      now: t0
    })
    await database.upsertRemoteSignatureScheme({
      domain: 'old-2.example',
      scheme: 'rfc9421',
      expiresAt: t0 + 2000,
      now: t0
    })
    await database.upsertRemoteSignatureScheme({
      domain: 'old-3.example',
      scheme: 'cavage',
      expiresAt: t0 + 3000,
      now: t0
    })
    await database.upsertRemoteSignatureScheme({
      domain: 'fresh.example',
      scheme: 'rfc9421',
      expiresAt: t0 + 60_000,
      now: t0
    })

    expect(
      await database.deleteExpiredRemoteSignatureSchemes({
        before: t0 + 5000,
        limit: 0
      })
    ).toBe(0)

    const firstBatch = await database.deleteExpiredRemoteSignatureSchemes({
      before: t0 + 3000,
      limit: 2
    })
    expect(firstBatch).toBe(2)

    const remainingBeforeSecondSweep = await db
      .selectFrom('remote_signature_schemes')
      .select('domain')
      .orderBy('domain', 'asc')
      .execute()
    expect(remainingBeforeSecondSweep.map((row) => row.domain)).toEqual([
      'fresh.example',
      'old-3.example'
    ])

    const rest = await database.deleteExpiredRemoteSignatureSchemes({
      before: t0 + 3000
    })
    expect(rest).toBe(1)

    const surviving = await db
      .selectFrom('remote_signature_schemes')
      .select('domain')
      .execute()
    expect(surviving.map((row) => row.domain)).toEqual(['fresh.example'])
  })

  it('rolls the migration down and back up cleanly', async () => {
    await remoteSignatureSchemeMigration.down(db)

    const afterDown = await db.introspection.getTables()
    expect(
      afterDown.some((table) => table.name === 'remote_signature_schemes')
    ).toBe(false)

    // Re-running down is idempotent.
    await remoteSignatureSchemeMigration.down(db)

    await remoteSignatureSchemeMigration.up(db)
    // Re-running up is idempotent.
    await remoteSignatureSchemeMigration.up(db)

    const afterUp = await db.introspection.getTables()
    expect(
      afterUp.some((table) => table.name === 'remote_signature_schemes')
    ).toBe(true)

    const t0 = Date.parse('2026-11-06T09:00:00.000Z')
    await database.upsertRemoteSignatureScheme({
      domain: 'roundtrip.example',
      scheme: 'rfc9421',
      expiresAt: t0 + 10_000,
      now: t0
    })
    const { rows } = await sql<{ count: number | string }>`
      select count(*) as count from remote_signature_schemes
    `.execute(db)
    expect(Number(rows[0].count)).toBe(1)
  })
})
