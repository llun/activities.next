import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { holdTransaction } from '@/lib/database/testing/heldTransaction'
import { type CapturedQuery } from '@/lib/database/testing/queryCapture'

// The statement capture every query-shape test relies on, checked on SQLite
// and, under TEST_DATABASE_TYPE=pg, PostgreSQL. This is the contract callers
// depend on, so it holds across whatever connection the test database runs on.
describe('statement capture on the test database', () => {
  const testDb = createTestDatabase()
  const { database, db, captureQueries, onQuery } = testDb

  // Placeholders are `?` on SQLite and `$n` on PostgreSQL.
  const placeholder = '(\\?|\\$1)'

  const readSetting = (key: string) =>
    db.selectFrom('server_settings').select('key').where('key', '=', key)

  const sqlOf = (statements: CapturedQuery[]) =>
    statements.map(({ sql }) => sql)

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  }, 30000)

  afterAll(async () => {
    await testDb.destroy()
  })

  it('returns each statement the driver sent, with its bindings', async () => {
    const statements = await captureQueries(async () => {
      await readSetting('capture.first').execute()
    })

    expect(statements).toHaveLength(1)
    expect(statements[0].sql).toMatch(
      new RegExp(
        `^select "key" from "server_settings" where "key" = ${placeholder}$`
      )
    )
    expect(statements[0].bindings).toEqual(['capture.first'])
    // Only the statement and its bindings, so a test can compare whole
    // statements without a driver's bookkeeping.
    expect(Object.keys(statements[0]).sort()).toEqual(['bindings', 'sql'])
  })

  it('returns the statements in the order they were sent', async () => {
    const statements = await captureQueries(async () => {
      await readSetting('capture.one').execute()
      await db.selectFrom('server_settings').select('value').execute()
      await readSetting('capture.two').execute()
    })

    expect(statements.map(({ bindings }) => bindings)).toEqual([
      ['capture.one'],
      [],
      ['capture.two']
    ])
  })

  it('captures what a facade method sends, not only direct queries', async () => {
    const statements = await captureQueries(() =>
      database.getAllServerSettings()
    )

    expect(statements.length).toBeGreaterThan(0)
    expect(sqlOf(statements).join('\n')).toContain('"server_settings"')
  })

  it('returns nothing for work that sends no statement', async () => {
    await expect(captureQueries(async () => {})).resolves.toEqual([])
    await expect(captureQueries(() => undefined)).resolves.toEqual([])
  })

  it('captures nothing outside the work it wraps', async () => {
    await readSetting('capture.before').execute()
    const statements = await captureQueries(async () => {
      await readSetting('capture.during').execute()
    })
    await readSetting('capture.after').execute()

    expect(statements.map(({ bindings }) => bindings)).toEqual([
      ['capture.during']
    ])
  })

  it('does not capture a later call twice, or a statement from an earlier one', async () => {
    await captureQueries(() => readSetting('capture.earlier').execute())
    const statements = await captureQueries(() =>
      readSetting('capture.later').execute()
    )

    expect(statements.map(({ bindings }) => bindings)).toEqual([
      ['capture.later']
    ])
  })

  it('lets captures nest: the outer sees every statement, the inner its own', async () => {
    let inner: CapturedQuery[] = []
    const outer = await captureQueries(async () => {
      await readSetting('capture.outer-1').execute()
      inner = await captureQueries(() => readSetting('capture.inner').execute())
      await readSetting('capture.outer-2').execute()
    })

    expect(inner.map(({ bindings }) => bindings)).toEqual([['capture.inner']])
    expect(outer.map(({ bindings }) => bindings)).toEqual([
      ['capture.outer-1'],
      ['capture.inner'],
      ['capture.outer-2']
    ])
  })

  it('captures the begin and commit of a transaction, on one connection', async () => {
    const events: { sql: string; connection: string }[] = []
    const stop = onQuery(({ sql, connection }) => {
      events.push({ sql, connection })
    })
    let statements: CapturedQuery[]
    try {
      statements = await captureQueries(() =>
        db.transaction().execute(async (trx) => {
          await trx
            .selectFrom('server_settings')
            .select('key')
            .where('key', '=', 'capture.trx-1')
            .execute()
          await trx
            .selectFrom('server_settings')
            .select('key')
            .where('key', '=', 'capture.trx-2')
            .execute()
        })
      )
    } finally {
      stop()
    }

    const texts = sqlOf(statements)
    expect(texts[0]).toBe('begin')
    expect(texts.at(-1)).toBe('commit')
    expect(texts).toHaveLength(4)
    expect(statements.slice(1, -1).map(({ bindings }) => bindings)).toEqual([
      ['capture.trx-1'],
      ['capture.trx-2']
    ])
    // The whole transaction ran on the connection that began it.
    expect(new Set(events.map(({ connection }) => connection)).size).toBe(1)
    expect(typeof events[0].connection).toBe('string')
  })

  // SQLite has one connection, so only PostgreSQL can tell two apart.
  it.runIf(testDb.backend === 'pg')(
    'reports a different connection for a statement outside an open transaction',
    async () => {
      const connections = new Map<string, string>()
      const stop = onQuery(({ bindings, connection }) => {
        connections.set(String(bindings[0]), connection)
      })
      let entered = () => {}
      let release = () => {}
      const inside = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      try {
        const held = db.transaction().execute(async (trx) => {
          await trx
            .selectFrom('server_settings')
            .select('key')
            .where('key', '=', 'capture.held')
            .execute()
          entered()
          await gate
        })
        await inside
        await readSetting('capture.elsewhere').execute()
        release()
        await held
      } finally {
        stop()
      }

      expect(connections.get('capture.held')).toBeTruthy()
      expect(connections.get('capture.elsewhere')).toBeTruthy()
      expect(connections.get('capture.elsewhere')).not.toBe(
        connections.get('capture.held')
      )
    }
  )

  it('captures the rollback of a failed transaction', async () => {
    const texts: string[] = []
    const stop = onQuery(({ sql }) => {
      texts.push(sql)
    })
    try {
      await expect(
        db.transaction().execute(async (trx) => {
          await trx
            .selectFrom('server_settings')
            .select('key')
            .where('key', '=', 'capture.rolled-back')
            .execute()
          throw new Error('forced failure')
        })
      ).rejects.toThrow('forced failure')
    } finally {
      stop()
    }

    expect(texts[0]).toBe('begin')
    expect(texts.at(-1)).toBe('rollback')
    expect(texts).toHaveLength(3)
  })

  it('rethrows what the work throws, and stops capturing', async () => {
    await expect(
      captureQueries(async () => {
        await readSetting('capture.before-throw').execute()
        throw new Error('work failed')
      })
    ).rejects.toThrow('work failed')

    const seen: string[] = []
    const stop = onQuery(({ bindings }) => {
      seen.push(String(bindings[0]))
    })
    await readSetting('capture.after-throw').execute()
    stop()
    // Only the listener registered afterwards saw the statement, once.
    expect(seen).toEqual(['capture.after-throw'])
  })

  describe('onQuery', () => {
    it('calls the listener for every statement until it is unsubscribed', async () => {
      const seen: unknown[][] = []
      const stop = onQuery(({ bindings }) => {
        seen.push(bindings)
      })

      await readSetting('capture.listen-1').execute()
      await readSetting('capture.listen-2').execute()
      stop()
      await readSetting('capture.listen-3').execute()

      expect(seen).toEqual([['capture.listen-1'], ['capture.listen-2']])
    })

    it('unsubscribes only its own listener, and tolerates being called twice', async () => {
      const first: string[] = []
      const second: string[] = []
      const stopFirst = onQuery(({ bindings }) => {
        first.push(String(bindings[0]))
      })
      const stopSecond = onQuery(({ bindings }) => {
        second.push(String(bindings[0]))
      })

      await readSetting('capture.both').execute()
      stopFirst()
      stopFirst()
      await readSetting('capture.second-only').execute()
      stopSecond()

      expect(first).toEqual(['capture.both'])
      expect(second).toEqual(['capture.both', 'capture.second-only'])
    })

    it('hands the listener a copy of the bindings', async () => {
      let received: unknown[] = []
      const stop = onQuery(({ bindings }) => {
        received = bindings
        bindings.push('tampered')
      })
      const statements = await captureQueries(() =>
        readSetting('capture.copy').execute()
      )
      stop()

      expect(received).toContain('tampered')
      expect(statements[0].bindings).toEqual(['capture.copy'])
    })

    it('fails the statement whose listener throws', async () => {
      const stop = onQuery(({ bindings }) => {
        if (bindings[0] === 'capture.explode') {
          throw new Error('listener refused the statement')
        }
      })
      try {
        await expect(readSetting('capture.explode').execute()).rejects.toThrow(
          'listener refused the statement'
        )
        // Other statements still run.
        await expect(readSetting('capture.fine').execute()).resolves.toEqual([])
      } finally {
        stop()
      }
    })
  })

  describe('pendingAcquires', () => {
    it('is zero when nothing waits for a connection', async () => {
      await readSetting('capture.idle').execute()
      expect(testDb.pendingAcquires()).toBe(0)
    })

    // SQLite has one connection, so a second caller queues behind a held one.
    // PostgreSQL's pool would need exhausting first, which this suite does not
    // do to a database other tests share.
    it.runIf(testDb.backend === 'sqlite')(
      'counts a caller queued behind the only connection',
      async () => {
        const held = await holdTransaction(db)
        let queued: Promise<unknown> | undefined
        try {
          queued = readSetting('capture.queued').execute()
          await expect
            .poll(() => testDb.pendingAcquires(), { timeout: 5000 })
            .toBe(1)
        } finally {
          await held.rollback()
        }
        await expect(queued).resolves.toEqual([])
        expect(testDb.pendingAcquires()).toBe(0)
      }
    )
  })
})
