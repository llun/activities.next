import { sql } from 'kysely'

import type { Db } from '@/lib/database/kysely'
import {
  forShare,
  forUpdate,
  fullTextMatch,
  getDialectName,
  jsonText,
  normalizedHashtagName,
  timestampValue,
  utcYearMonth
} from '@/lib/database/kysely/dialect'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { createCompileOnlyDb } from '@/lib/database/testing/compileOnlyDb'
import type { Database } from '@/lib/database/types'

// Compiles only: neither instance connects.
const sqlite = createCompileOnlyDb('sqlite')
const postgres = createCompileOnlyDb('pg')

describe('getDialectName', () => {
  it('names each backend', () => {
    expect(getDialectName(sqlite)).toBe('sqlite')
    expect(getDialectName(postgres)).toBe('postgres')
  })
})

describe('forUpdate', () => {
  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for update' }
  ])('locks rows only where the backend supports it ($name)', (item) => {
    const db = item.instance
    const query = forUpdate(db, db.selectFrom('likes').select('statusId'))
    expect(query.compile().sql).toMatch(
      new RegExp(`from "likes"${item.suffix}$`)
    )
  })

  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for update of "medias"' }
  ])('locks only the named table of a join ($name)', (item) => {
    const db = item.instance
    const query = forUpdate(
      db,
      db
        .selectFrom('medias')
        .innerJoin('actors', 'medias.actorId', 'actors.id')
        .select('medias.id'),
      'medias'
    )
    expect(query.compile().sql).toMatch(
      new RegExp(`"actors"."id"${item.suffix}$`)
    )
  })

  it('refuses a table the query does not read', () => {
    const db = postgres
    const query = db.selectFrom('medias').select('id')
    // @ts-expect-error not a table of this query
    forUpdate(db, query, 'actors')
  })
})

describe('forShare', () => {
  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for share' }
  ])(
    'takes a share lock only where the backend supports it ($name)',
    (item) => {
      const db = item.instance
      const query = forShare(
        db,
        db.selectFrom('follows').select('targetActorId')
      )
      expect(query.compile().sql).toMatch(
        new RegExp(`from "follows"${item.suffix}$`)
      )
    }
  )
})

describe('timestampValue', () => {
  it('binds a Date for epoch milliseconds and for a Date', () => {
    const db = sqlite
    const at = new Date('2026-04-01T00:00:00.000Z')
    const compiled = db
      .selectFrom('likes')
      .select('statusId')
      .where('createdAt', '<', timestampValue(at.getTime()))
      .where('updatedAt', '<', timestampValue(at))
      .compile()
    expect(compiled.parameters).toEqual([at, at])
  })
})

describe('timestamp column types', () => {
  it('rejects a bare number as a comparison operand', () => {
    const db = sqlite
    // A bare number fails on PostgreSQL, so the column reads as a branded
    // EpochMs, which stops bare numbers (read-back values still type-check, so
    // they must go through timestampValue() too).
    db.selectFrom('likes')
      .select('statusId')
      // @ts-expect-error a plain number is not an EpochMs
      .where('createdAt', '<', 123)
      .compile()
  })
})

describe('jsonText', () => {
  it.each([
    {
      name: 'sqlite',
      instance: sqlite,
      sql: `select json_extract("actors"."settings", '$.followersUrl') as "url" from "actors"`
    },
    {
      name: 'postgres',
      instance: postgres,
      sql: `select "actors"."settings"::jsonb ->> 'followersUrl' as "url" from "actors"`
    }
  ])('reads a property of a JSON column ($name)', (item) => {
    const db = item.instance
    const query = db
      .selectFrom('actors')
      .select(jsonText(db, 'actors.settings', 'followersUrl').as('url'))
    expect(query.compile().sql).toBe(item.sql)
    expect(query.compile().parameters).toEqual([])
  })

  it.each([
    {
      name: 'sqlite',
      instance: sqlite,
      sql: `select json_extract("medias"."originalMetaData", '$.upload.state') as "state" from "medias"`
    },
    {
      name: 'postgres',
      instance: postgres,
      sql: `select "medias"."originalMetaData"::jsonb -> 'upload' ->> 'state' as "state" from "medias"`
    }
  ])('reads a property of a nested object ($name)', (item) => {
    const db = item.instance
    const query = db
      .selectFrom('medias')
      .select(
        jsonText(db, 'medias.originalMetaData', 'upload', 'state').as('state')
      )
    expect(query.compile().sql).toBe(item.sql)
    expect(query.compile().parameters).toEqual([])
  })
})

describe('fullTextMatch', () => {
  it('joins the FTS5 table and matches each token as a prefix (sqlite)', () => {
    const db = sqlite
    const compiled = fullTextMatch(
      db,
      db.selectFrom('search_documents').select('search_documents.id'),
      ['trail', 'run_1']
    ).compile()
    expect(compiled.sql).toBe(
      'select "search_documents"."id" from "search_documents" inner join "search_documents_fts" on search_documents_fts.rowid = search_documents.rowid where search_documents_fts match ?'
    )
    expect(compiled.parameters).toEqual(['trail* run_1*'])
  })

  it('matches the to_tsvector index expression, ANDing the prefixes (postgres)', () => {
    const db = postgres
    const compiled = fullTextMatch(
      db,
      db.selectFrom('search_documents').select('search_documents.id'),
      ['trail', 'run_1']
    ).compile()
    expect(compiled.sql).toBe(
      `select "search_documents"."id" from "search_documents" where to_tsvector('simple', "documentText") @@ to_tsquery('simple', $1)`
    )
    expect(compiled.parameters).toEqual(['trail:* & run_1:*'])
  })
})

describe('normalizedHashtagName', () => {
  it.each([
    {
      name: 'sqlite',
      instance: sqlite,
      sql: 'select lower(ltrim("tags"."nameNormalized", ?)) as "name" from "tags"',
      parameters: ['#']
    },
    {
      name: 'postgres',
      instance: postgres,
      sql: `select lower(trim(leading '#' from "tags"."nameNormalized")) as "name" from "tags"`,
      parameters: []
    }
  ])('strips the leading hashes and lowercases ($name)', (item) => {
    const db = item.instance
    const compiled = db
      .selectFrom('tags')
      .select(normalizedHashtagName(db, 'tags.nameNormalized').as('name'))
      .compile()
    expect(compiled.sql).toBe(item.sql)
    expect(compiled.parameters).toEqual(item.parameters)
  })
})

describe('utcYearMonth', () => {
  it.each([
    {
      name: 'sqlite',
      instance: sqlite,
      sql: `select strftime('%Y-%m', "likes"."createdAt" / 1000.0, 'unixepoch') as "ym" from "likes"`
    },
    {
      name: 'postgres',
      instance: postgres,
      sql: `select to_char("likes"."createdAt" at time zone 'UTC', 'YYYY-MM') as "ym" from "likes"`
    }
  ])('compiles string column reference ($name)', (item) => {
    const db = item.instance
    const compiled = db
      .selectFrom('likes')
      .select(utcYearMonth(db, 'likes.createdAt').as('ym'))
      .compile()
    expect(compiled.sql).toBe(item.sql)
    expect(compiled.parameters).toEqual([])
  })

  it.each([
    {
      name: 'sqlite',
      instance: sqlite,
      sql: `select strftime('%Y-%m', "likes"."createdAt" / 1000.0, 'unixepoch') as "ym" from "likes"`
    },
    {
      name: 'postgres',
      instance: postgres,
      sql: `select to_char("likes"."createdAt" at time zone 'UTC', 'YYYY-MM') as "ym" from "likes"`
    }
  ])('compiles Expression reference ($name)', (item) => {
    const db = item.instance
    const compiled = db
      .selectFrom('likes')
      .select(utcYearMonth(db, sql.ref('likes.createdAt')).as('ym'))
      .compile()
    expect(compiled.sql).toBe(item.sql)
    expect(compiled.parameters).toEqual([])
  })

  describe('real database execution', () => {
    let database: Database
    let db: Db

    beforeAll(async () => {
      const test = getTestDatabaseWithInstance()
      database = test.database
      db = test.db
      await test.prepare()
      await database.migrate()
    })

    afterAll(async () => {
      await database.destroy()
    })

    it.each([
      {
        description: 'pre-1970 date',
        date: new Date('1965-06-15T12:00:00.000Z'),
        expected: '1965-06'
      },
      {
        description: '23:59:59.999 date',
        date: new Date('2026-03-31T23:59:59.999Z'),
        expected: '2026-03'
      },
      {
        description: 'regular date',
        date: new Date('2024-10-24T15:30:00.000Z'),
        expected: '2024-10'
      }
    ])(
      'extracts UTC year and month on active database backend ($description)',
      async ({ date, expected }) => {
        const id = `counter-${date.getTime()}`
        await db
          .insertInto('counters')
          .values({
            id,
            value: 1,
            createdAt: date,
            updatedAt: date
          })
          .execute()

        const row = await db
          .selectFrom('counters')
          .select([
            utcYearMonth(db, 'counters.createdAt').as('ymString'),
            utcYearMonth(db, sql.ref('counters.createdAt')).as('ymExpr')
          ])
          .where('id', '=', id)
          .executeTakeFirstOrThrow()

        expect(row.ymString).toBe(expected)
        expect(row.ymExpr).toBe(expected)
      }
    )
  })
})
