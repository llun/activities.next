import type { Knex } from 'knex'
import { expect } from 'vitest'

import { Database } from '@/lib/database/types'

// The pyramid is keyed one-per-actor and the tile assertions are exact
// counts and sums, so every test gets an actor nothing else touches
// rather than sharing one of the seeded ones.
let actorSequence = 0
export const createActor = async (db: Database) => {
  actorSequence += 1
  const username = `tile-actor-${actorSequence}`
  const actorId = `https://llun.test/users/${username}`
  await db.createActor({
    actorId,
    username,
    domain: 'llun.test',
    inboxUrl: `${actorId}/inbox`,
    followersUrl: `${actorId}/followers`,
    sharedInboxUrl: 'https://llun.test/inbox',
    publicKey: `public-key-${username}`,
    privateKey: `private-key-${username}`,
    createdAt: Date.now()
  })
  return actorId
}

// Tile writes are fenced on the build's ownership token, so a test that
// wants to write tiles has to own a build first.
export const claimBuild = async (db: Database, actorId: string) => {
  const claim = await db.claimFitnessRouteHeatmapPyramidBuild({
    actorId,
    requestedAt: Date.now(),
    staleBefore: Date.now() - 120_000
  })
  expect(claim.claimed).toBe(true)
  return claim.pyramid
}

// Every guarded write names the build ROW as well as the token, because
// `claimSeq` restarts at zero when a clear deletes the row.
export const fence = (pyramid: { id: string; claimSeq: number }) => ({
  pyramidId: pyramid.id,
  claimSeq: pyramid.claimSeq
})

/**
 * Asserts that two statements ran inside ONE open transaction on ONE
 * connection.
 *
 * Structural, because what these transactions prevent is a failure between
 * two round trips and there is no seam to inject one at. Order alone is not
 * enough: keeping the `database.transaction(...)` wrapper while building a
 * query on `database` instead of `trx` — the likeliest refactoring slip
 * there is — leaves the order untouched while that statement autocommits on
 * a pooled connection, which is the state these transactions exist to
 * remove. The pool also hands the same connection to unrelated
 * transactions, so "a BEGIN appeared earlier" is not enough either; the one
 * that matters must still be open.
 */
export const expectOneTransaction = (
  statements: Array<{ sql: string; connection: string }>,
  firstMatches: (sql: string) => boolean,
  secondMatches: (sql: string) => boolean
) => {
  // Without this the whole helper degrades to an order-only check the
  // moment knex stops carrying `__knexUid`, which is exactly the weaker
  // assertion it was written to replace.
  for (const statement of statements) {
    expect(typeof statement.connection).toBe('string')
  }

  const firstIndex = statements.findIndex(({ sql }) => firstMatches(sql))
  expect(firstIndex).toBeGreaterThan(-1)
  const secondIndex = statements.findIndex(
    ({ sql }, index) => index > firstIndex && secondMatches(sql)
  )
  expect(secondIndex).toBeGreaterThan(firstIndex)

  const connection = statements[firstIndex].connection
  expect(statements[secondIndex].connection).toBe(connection)

  const onConnection = (index: number) =>
    statements[index].connection === connection
  const opens = (index: number) =>
    onConnection(index) && /^begin/i.test(statements[index].sql)
  const closes = (index: number) =>
    onConnection(index) && /^(commit|rollback)/i.test(statements[index].sql)

  let open = false
  for (let index = 0; index < firstIndex; index += 1) {
    if (opens(index)) open = true
    else if (closes(index)) open = false
  }
  expect(open).toBe(true)

  for (let index = firstIndex; index < secondIndex; index += 1) {
    expect(closes(index)).toBe(false)
  }
}

export const recordStatements = (instance: Knex) => {
  const statements: Array<{ sql: string; connection: string }> = []
  instance.on(
    'query',
    ({ sql, __knexUid }: { sql: string; __knexUid: string }) => {
      statements.push({ sql: sql.trimStart(), connection: __knexUid })
    }
  )
  return statements
}

export const tile = (tileKey: string, pointCount = 4) => {
  const [z, x, y] = tileKey.split(':').map(Number)
  return {
    tileKey,
    z,
    x,
    y,
    segments: `{"e":256,"s":[{"c":1,"p":[0,0,8,8]}],"k":"${tileKey}"}`,
    pointCount
  }
}
