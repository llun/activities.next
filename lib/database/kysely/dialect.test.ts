import knex from 'knex'

import { kyselyFor } from '@/lib/database/kysely'
import {
  forUpdate,
  fullTextMatch,
  getDialectName,
  jsonText,
  normalizedHashtagName,
  timestampValue
} from '@/lib/database/kysely/dialect'

// Compiles only: neither instance connects.
const sqlite = knex({
  client: 'better-sqlite3',
  useNullAsDefault: true,
  connection: { filename: ':memory:' }
})
const postgres = knex({ client: 'pg', connection: {} })

afterAll(async () => {
  await Promise.all([sqlite.destroy(), postgres.destroy()])
})

describe('getDialectName', () => {
  it('names each backend', () => {
    expect(getDialectName(kyselyFor(sqlite))).toBe('sqlite')
    expect(getDialectName(kyselyFor(postgres))).toBe('postgres')
  })
})

describe('forUpdate', () => {
  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for update' }
  ])('locks rows only where the backend supports it ($name)', (item) => {
    const db = kyselyFor(item.instance)
    const query = forUpdate(db, db.selectFrom('likes').select('statusId'))
    expect(query.compile().sql).toMatch(
      new RegExp(`from "likes"${item.suffix}$`)
    )
  })

  it.each([
    { name: 'sqlite', instance: sqlite, suffix: '' },
    { name: 'postgres', instance: postgres, suffix: ' for update of "medias"' }
  ])('locks only the named table of a join ($name)', (item) => {
    const db = kyselyFor(item.instance)
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
    const db = kyselyFor(postgres)
    const query = db.selectFrom('medias').select('id')
    // @ts-expect-error not a table of this query
    forUpdate(db, query, 'actors')
  })
})

describe('timestampValue', () => {
  it('binds a Date for epoch milliseconds and for a Date', () => {
    const db = kyselyFor(sqlite)
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
    const db = kyselyFor(sqlite)
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
    const db = kyselyFor(item.instance)
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
    const db = kyselyFor(item.instance)
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
    const db = kyselyFor(sqlite)
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
    const db = kyselyFor(postgres)
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
    const db = kyselyFor(item.instance)
    const compiled = db
      .selectFrom('tags')
      .select(normalizedHashtagName(db, 'tags.nameNormalized').as('name'))
      .compile()
    expect(compiled.sql).toBe(item.sql)
    expect(compiled.parameters).toEqual(item.parameters)
  })
})
