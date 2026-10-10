import { type Insertable, sql } from 'kysely'

import type {
  DomainAllow,
  DomainBlock,
  DomainBlockSeverity
} from '@/lib/database/domains/admin/types'
import type { DomainFederationRules } from '@/lib/database/kysely/db'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'

// The domain block and allow rules run on a database holding only the rules each
// test seeds, so every expectation is exact and the neighbouring rows (the other
// type of rule, other domains, other ids) show up if a query reaches them.
describe('AdminDatabase domain federation rules', () => {
  const testDb = createTestDatabase()
  const database = testDb.database
  const at = (seconds: number) =>
    new Date(Date.UTC(2024, 5, 1) + seconds * 1000)

  type RuleSeed = {
    type: 'block' | 'allow'
    domain: string
    id?: string
  } & Partial<Insertable<DomainFederationRules>>

  const seedRules = async (rules: RuleSeed[]) => {
    const rows = rules.map(
      ({
        type,
        domain,
        id,
        ...overrides
      }): Insertable<DomainFederationRules> => ({
        id: id ?? `${type}-${domain}`,
        type,
        domain,
        severity: type === 'block' ? 'suspend' : null,
        rejectMedia: false,
        rejectReports: false,
        privateComment: null,
        publicComment: null,
        obfuscate: false,
        source: null,
        createdAt: at(0),
        updatedAt: at(0),
        ...overrides
      })
    )
    // Few enough rows per statement for SQLite's bound-parameter limit.
    for (let start = 0; start < rows.length; start += 50) {
      await testDb.db
        .insertInto('domain_federation_rules')
        .values(rows.slice(start, start + 50))
        .execute()
    }
  }

  const readRules = () =>
    testDb.db
      .selectFrom('domain_federation_rules')
      .selectAll()
      .orderBy('type')
      .orderBy('domain')
      .execute()

  const blockOf = (
    domain: string,
    overrides: Partial<DomainBlock> = {}
  ): DomainBlock => ({
    id: `block-${domain}`,
    domain,
    type: 'block',
    severity: 'suspend',
    rejectMedia: false,
    rejectReports: false,
    privateComment: null,
    publicComment: null,
    obfuscate: false,
    source: null,
    createdAt: at(0).getTime(),
    updatedAt: at(0).getTime(),
    ...overrides
  })

  const allowOf = (domain: string): DomainAllow => ({
    id: `allow-${domain}`,
    domain,
    type: 'allow',
    createdAt: at(0).getTime(),
    updatedAt: at(0).getTime()
  })

  const domainsOf = (rules: { domain: string }[]) =>
    rules.map((rule) => rule.domain)

  beforeAll(async () => {
    await testDb.prepare()
    await database.migrate()
  })

  beforeEach(async () => {
    await testDb.db.deleteFrom('domain_federation_rules').execute()
  })

  afterAll(async () => {
    await testDb.destroy()
  })

  describe('getDomainBlocks and getDomainAllows', () => {
    it('list the rules of their own type by domain', async () => {
      await seedRules([
        { type: 'block', domain: 'c.test' },
        { type: 'allow', domain: 'zz.test' },
        { type: 'block', domain: 'a.test' },
        { type: 'allow', domain: 'bb.test' },
        { type: 'block', domain: 'b.test' },
        { type: 'allow', domain: 'aa.test' }
      ])

      await expect(database.getDomainBlocks()).resolves.toEqual([
        blockOf('a.test'),
        blockOf('b.test'),
        blockOf('c.test')
      ])
      await expect(database.getDomainAllows()).resolves.toEqual([
        allowOf('aa.test'),
        allowOf('bb.test'),
        allowOf('zz.test')
      ])
    })

    it('maps every column of a block and treats a missing severity as suspend', async () => {
      await seedRules([
        {
          type: 'block',
          domain: 'full.test',
          severity: 'silence',
          rejectMedia: true,
          rejectReports: true,
          privateComment: 'private note',
          publicComment: 'public note',
          obfuscate: true,
          source: 'list-a',
          createdAt: at(10),
          updatedAt: at(20)
        },
        { type: 'block', domain: 'legacy.test', severity: null },
        { type: 'block', domain: 'odd.test', severity: 'unknown' },
        { type: 'block', domain: 'quiet.test', severity: 'noop' }
      ])

      await expect(database.getDomainBlocks()).resolves.toEqual([
        blockOf('full.test', {
          severity: 'silence',
          rejectMedia: true,
          rejectReports: true,
          privateComment: 'private note',
          publicComment: 'public note',
          obfuscate: true,
          source: 'list-a',
          createdAt: at(10).getTime(),
          updatedAt: at(20).getTime()
        }),
        blockOf('legacy.test'),
        blockOf('odd.test'),
        blockOf('quiet.test', { severity: 'noop' })
      ])
    })

    it('filters blocks by severity, and an empty filter keeps them all', async () => {
      await seedRules([
        { type: 'block', domain: 'a.test', severity: 'suspend' },
        { type: 'block', domain: 'b.test', severity: 'silence' },
        { type: 'block', domain: 'c.test', severity: 'noop' },
        { type: 'block', domain: 'd.test', severity: 'suspend' },
        { type: 'allow', domain: 'e.test' }
      ])

      const domains = async (severities: DomainBlockSeverity[]) =>
        domainsOf(await database.getDomainBlocks({ severities }))

      expect(await domains(['silence'])).toEqual(['b.test'])
      expect(await domains(['noop', 'suspend'])).toEqual([
        'a.test',
        'c.test',
        'd.test'
      ])
      expect(await domains([])).toEqual([
        'a.test',
        'b.test',
        'c.test',
        'd.test'
      ])
    })

    it('pages with limit and offset, 100 rules by default', async () => {
      const names = Array.from(
        { length: 105 },
        (_, index) => `host-${String(index).padStart(3, '0')}.test`
      )
      await seedRules([
        ...names.map((domain) => ({ type: 'block' as const, domain })),
        ...names.map((domain) => ({ type: 'allow' as const, domain }))
      ])

      const blocks = await database.getDomainBlocks()
      expect(domainsOf(blocks)).toEqual(names.slice(0, 100))
      expect(blocks.every((block) => block.type === 'block')).toBe(true)
      expect(
        domainsOf(await database.getDomainBlocks({ limit: 3, offset: 2 }))
      ).toEqual(names.slice(2, 5))
      expect(
        domainsOf(await database.getDomainBlocks({ offset: 100 }))
      ).toEqual(names.slice(100))

      const allows = await database.getDomainAllows()
      expect(domainsOf(allows)).toEqual(names.slice(0, 100))
      expect(allows.every((allow) => allow.type === 'allow')).toBe(true)
      expect(
        domainsOf(await database.getDomainAllows({ limit: 3, offset: 2 }))
      ).toEqual(names.slice(2, 5))
      expect(
        domainsOf(await database.getDomainAllows({ offset: 100 }))
      ).toEqual(names.slice(100))
    })
  })

  describe('cursor pagination', () => {
    // Blocks a-f, with allows between them: a cursor must bound blocks by
    // the domain of the block it names, never by an allow.
    const seedCursorRules = () =>
      seedRules([
        { type: 'block', domain: 'a.test', severity: 'suspend' },
        { type: 'block', domain: 'b.test', severity: 'silence' },
        { type: 'block', domain: 'c.test', severity: 'suspend' },
        { type: 'block', domain: 'd.test', severity: 'silence' },
        { type: 'block', domain: 'e.test', severity: 'suspend' },
        { type: 'block', domain: 'f.test', severity: 'silence' },
        { type: 'allow', domain: 'bb.test' },
        { type: 'allow', domain: 'cc.test' },
        { type: 'allow', domain: 'dd.test' },
        { type: 'allow', domain: 'ee.test' }
      ])

    it('maxId pages toward larger domains', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({ maxId: 'block-c.test', limit: 2 })
        )
      ).toEqual(['d.test', 'e.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({ maxId: 'block-f.test', limit: 2 })
        )
      ).toEqual([])
    })

    it('minId returns the page just before the cursor, oldest first', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({ minId: 'block-e.test', limit: 2 })
        )
      ).toEqual(['c.test', 'd.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({ minId: 'block-a.test', limit: 2 })
        )
      ).toEqual([])
    })

    it('sinceId returns the first rows before the cursor', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({ sinceId: 'block-e.test', limit: 2 })
        )
      ).toEqual(['a.test', 'b.test'])
    })

    it('prefers maxId to minId to sinceId', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({
            maxId: 'block-c.test',
            minId: 'block-e.test',
            sinceId: 'block-e.test',
            limit: 2
          })
        )
      ).toEqual(['d.test', 'e.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({
            minId: 'block-e.test',
            sinceId: 'block-b.test',
            limit: 2
          })
        )
      ).toEqual(['c.test', 'd.test'])
    })

    it('ignores the offset once there is a cursor', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({
            maxId: 'block-a.test',
            limit: 2,
            offset: 3
          })
        )
      ).toEqual(['b.test', 'c.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({
            minId: 'block-f.test',
            limit: 2,
            offset: 1
          })
        )
      ).toEqual(['d.test', 'e.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({
            sinceId: 'block-f.test',
            limit: 2,
            offset: 1
          })
        )
      ).toEqual(['a.test', 'b.test'])
    })

    it('applies no bound for a cursor that names no block', async () => {
      await seedCursorRules()

      // An allow's id and an id that exists nowhere are the same thing to a
      // block listing.
      for (const unknownId of ['allow-cc.test', 'missing']) {
        expect(
          domainsOf(
            await database.getDomainBlocks({ maxId: unknownId, limit: 2 })
          )
        ).toEqual(['a.test', 'b.test'])
        expect(
          domainsOf(
            await database.getDomainBlocks({ minId: unknownId, limit: 2 })
          )
        ).toEqual(['e.test', 'f.test'])
        expect(
          domainsOf(
            await database.getDomainBlocks({ sinceId: unknownId, limit: 2 })
          )
        ).toEqual(['a.test', 'b.test'])
      }
    })

    it('combines a cursor with the severity filter', async () => {
      await seedCursorRules()

      expect(
        domainsOf(
          await database.getDomainBlocks({
            maxId: 'block-a.test',
            severities: ['silence']
          })
        )
      ).toEqual(['b.test', 'd.test', 'f.test'])
      expect(
        domainsOf(
          await database.getDomainBlocks({
            minId: 'block-f.test',
            severities: ['suspend'],
            limit: 2
          })
        )
      ).toEqual(['c.test', 'e.test'])
    })

    it('pages allows the same way and never by a block', async () => {
      await seedRules([
        { type: 'allow', domain: 'a.test' },
        { type: 'allow', domain: 'b.test' },
        { type: 'allow', domain: 'c.test' },
        { type: 'allow', domain: 'd.test' },
        { type: 'allow', domain: 'e.test' },
        { type: 'block', domain: 'bb.test' },
        { type: 'block', domain: 'cc.test' }
      ])

      expect(
        domainsOf(
          await database.getDomainAllows({ maxId: 'allow-b.test', limit: 2 })
        )
      ).toEqual(['c.test', 'd.test'])
      expect(
        domainsOf(
          await database.getDomainAllows({ minId: 'allow-d.test', limit: 2 })
        )
      ).toEqual(['b.test', 'c.test'])
      expect(
        domainsOf(
          await database.getDomainAllows({ sinceId: 'allow-d.test', limit: 2 })
        )
      ).toEqual(['a.test', 'b.test'])
      expect(
        domainsOf(
          await database.getDomainAllows({
            maxId: 'allow-a.test',
            limit: 2,
            offset: 2
          })
        )
      ).toEqual(['b.test', 'c.test'])
      // The block's domain would have bounded this page if it were a cursor.
      expect(
        domainsOf(
          await database.getDomainAllows({ maxId: 'block-cc.test', limit: 2 })
        )
      ).toEqual(['a.test', 'b.test'])
      expect(
        domainsOf(
          await database.getDomainAllows({ minId: 'block-bb.test', limit: 2 })
        )
      ).toEqual(['d.test', 'e.test'])
      expect(
        domainsOf(
          await database.getDomainAllows({ sinceId: 'missing', limit: 2 })
        )
      ).toEqual(['a.test', 'b.test'])
    })
  })

  describe('getDomainBlockById and getDomainAllowById', () => {
    it('return a rule of their own type only', async () => {
      await seedRules([
        { type: 'block', domain: 'one.test', severity: 'silence' },
        { type: 'block', domain: 'two.test' },
        { type: 'allow', domain: 'one.test' },
        { type: 'allow', domain: 'two.test' }
      ])

      await expect(
        database.getDomainBlockById('block-one.test')
      ).resolves.toEqual(blockOf('one.test', { severity: 'silence' }))
      await expect(
        database.getDomainAllowById('allow-two.test')
      ).resolves.toEqual(allowOf('two.test'))

      await expect(
        database.getDomainBlockById('allow-one.test')
      ).resolves.toBeNull()
      await expect(
        database.getDomainAllowById('block-one.test')
      ).resolves.toBeNull()
      await expect(database.getDomainBlockById('missing')).resolves.toBeNull()
      await expect(database.getDomainAllowById('missing')).resolves.toBeNull()
    })
  })

  describe('getDomainBlockForDomain and getDomainAllowForDomain', () => {
    const lookups = [
      {
        type: 'block' as const,
        other: 'allow' as const,
        lookup: (domain: string) => database.getDomainBlockForDomain(domain)
      },
      {
        type: 'allow' as const,
        other: 'block' as const,
        lookup: (domain: string) => database.getDomainAllowForDomain(domain)
      }
    ]

    describe.each(lookups)('$type', ({ type, other, lookup }) => {
      const seedBoth = (domains: string[]) =>
        seedRules(
          domains.flatMap((domain) => [
            { type, domain },
            { type: other, domain }
          ])
        )

      const removeRule = (domain: string) =>
        testDb.db
          .deleteFrom('domain_federation_rules')
          .where('id', '=', `${type}-${domain}`)
          .execute()

      it('finds the most specific rule, exact before wildcard and longer before shorter', async () => {
        await seedBoth([
          '*',
          '*.test',
          '*.b.test',
          'a.b.test',
          // Rules that do not apply to a.b.test.
          'b.test',
          '*.a.b.test',
          'x.b.test',
          '*.x.test'
        ])

        for (const expected of ['a.b.test', '*.b.test', '*.test', '*']) {
          const rule = await lookup('a.b.test')
          expect(rule).toMatchObject({ id: `${type}-${expected}`, type })
          await removeRule(expected)
        }

        // Only rules for other domains and for the other type are left.
        await expect(lookup('a.b.test')).resolves.toBeNull()
      })

      it('puts an exact rule before a wildcard of the same length', async () => {
        await seedRules([
          { type, domain: '*.test' },
          { type, domain: 'a.test' },
          { type, domain: '*' },
          { type, domain: 'a' }
        ])

        await expect(lookup('a.test')).resolves.toMatchObject({
          domain: 'a.test'
        })
        await expect(lookup('a')).resolves.toMatchObject({ domain: 'a' })
        await expect(lookup('b.test')).resolves.toMatchObject({
          domain: '*.test'
        })
        await expect(lookup('*')).resolves.toMatchObject({ domain: '*' })
      })

      it('matches a wildcard given as the domain', async () => {
        await seedBoth(['*.b.test', '*.test'])

        await expect(lookup('*.b.test')).resolves.toMatchObject({
          domain: '*.b.test'
        })
      })

      it('only returns a rule of its own type', async () => {
        await seedRules([
          { type: other, domain: 'a.test' },
          { type: other, domain: '*' }
        ])

        await expect(lookup('a.test')).resolves.toBeNull()

        await seedRules([{ type, domain: '*.test' }])
        await expect(lookup('a.test')).resolves.toMatchObject({
          id: `${type}-*.test`,
          type
        })
      })

      it('normalizes the domain it is given and returns null for an invalid one', async () => {
        await seedBoth(['a.b.test', '*'])

        for (const input of [
          'a.b.test',
          '  A.B.Test ',
          'https://a.b.test/some/path',
          'a.b.test.'
        ]) {
          await expect(lookup(input)).resolves.toMatchObject({
            domain: 'a.b.test'
          })
        }
        await expect(lookup('other.test')).resolves.toMatchObject({
          domain: '*'
        })
        for (const invalid of ['', '   ', 'not a domain']) {
          await expect(lookup(invalid)).resolves.toBeNull()
        }
      })
    })
  })

  describe('getDomainBlocksForDomains and getDomainAllowsForDomains', () => {
    const lookups = [
      {
        type: 'block' as const,
        other: 'allow' as const,
        lookup: (domains: string[]) =>
          database.getDomainBlocksForDomains(domains)
      },
      {
        type: 'allow' as const,
        other: 'block' as const,
        lookup: (domains: string[]) =>
          database.getDomainAllowsForDomains(domains)
      }
    ]

    describe.each(lookups)('$type', ({ type, other, lookup }) => {
      it('maps each normalized domain to its most specific rule or null', async () => {
        await seedRules([
          { type, domain: 'a.b.test' },
          { type, domain: '*.b.test' },
          { type, domain: '*.test' },
          { type, domain: '*.other.example' },
          { type: other, domain: 'c.other.example' },
          { type: other, domain: 'z.nowhere.invalid' },
          { type: other, domain: '*' }
        ])

        const result = await lookup([
          'a.b.test',
          'c.b.test',
          'x.test',
          'c.other.example',
          'z.nowhere.invalid'
        ])

        expect(Object.keys(result).sort()).toEqual([
          'a.b.test',
          'c.b.test',
          'c.other.example',
          'x.test',
          'z.nowhere.invalid'
        ])
        expect(result['a.b.test']).toMatchObject({
          id: `${type}-a.b.test`,
          type
        })
        expect(result['c.b.test']).toMatchObject({
          id: `${type}-*.b.test`,
          type
        })
        expect(result['x.test']).toMatchObject({
          id: `${type}-*.test`,
          type
        })
        expect(result['c.other.example']).toMatchObject({
          id: `${type}-*.other.example`,
          type
        })
        // Only the other type has a rule for it.
        expect(result['z.nowhere.invalid']).toBeNull()
      })

      it('keys the result by normalized domain and drops duplicates and invalid ones', async () => {
        await seedRules([{ type, domain: 'a.test' }])

        const result = await lookup([
          'https://A.test/path',
          'a.test',
          ' b.test ',
          'not a domain',
          ''
        ])

        expect(Object.keys(result).sort()).toEqual(['a.test', 'b.test'])
        expect(result['a.test']).toMatchObject({ id: `${type}-a.test` })
        expect(result['b.test']).toBeNull()

        await expect(lookup([])).resolves.toEqual({})
        await expect(lookup(['not a domain', ''])).resolves.toEqual({})
      })

      it('finds the rules for thousands of domains', async () => {
        const domains = Array.from(
          { length: 2600 },
          (_, index) => `host-${index}.bulk.test`
        )
        // Exact rules at the start, middle and end of the list, a wildcard for
        // the rest, and a rule of the other type for a domain in the middle.
        const exact = [domains[0], domains[1301], domains[2599]]
        await seedRules([
          ...exact.map((domain) => ({ type, domain })),
          { type, domain: '*.bulk.test' },
          { type: other, domain: domains[700] }
        ])

        const result = await lookup(domains)

        expect(Object.keys(result)).toHaveLength(2600)
        for (const domain of domains) {
          expect(result[domain]).toMatchObject({
            domain: exact.includes(domain) ? domain : '*.bulk.test',
            type
          })
        }
      })
    })
  })

  describe('getDomainFederationRuleStats', () => {
    it('is all zeros without rules', async () => {
      await expect(database.getDomainFederationRuleStats()).resolves.toEqual({
        blocks: 0,
        suspendBlocks: 0,
        silenceBlocks: 0,
        allows: 0,
        sourceBlocks: 0,
        sourceCounts: {}
      })
    })

    it('counts blocks by severity and source, and allows apart', async () => {
      await seedRules([
        { type: 'block', domain: 'a.test', severity: 'suspend', source: 'one' },
        { type: 'block', domain: 'b.test', severity: 'suspend', source: 'one' },
        { type: 'block', domain: 'c.test', severity: 'suspend' },
        { type: 'block', domain: 'd.test', severity: 'silence', source: 'two' },
        { type: 'block', domain: 'e.test', severity: 'silence' },
        { type: 'block', domain: 'f.test', severity: 'noop', source: 'one' },
        // Allows count as allows only, even with a source set.
        { type: 'allow', domain: 'a.test', source: 'one' },
        { type: 'allow', domain: 'b.test', source: 'three' },
        { type: 'allow', domain: 'c.test' }
      ])

      await expect(database.getDomainFederationRuleStats()).resolves.toEqual({
        blocks: 6,
        suspendBlocks: 3,
        silenceBlocks: 2,
        allows: 3,
        sourceBlocks: 4,
        sourceCounts: { one: 3, two: 1 }
      })
    })
  })

  describe('createDomainBlock', () => {
    it('stores a block with its defaults and a normalized domain', async () => {
      const before = Date.now()

      const block = await database.createDomainBlock({
        domain: 'https://Example.COM/some/path'
      })

      expect(block).toMatchObject({
        domain: 'example.com',
        type: 'block',
        severity: 'suspend',
        rejectMedia: false,
        rejectReports: false,
        privateComment: null,
        publicComment: null,
        obfuscate: false,
        source: null
      })
      expect(block.id).toBeTruthy()
      expect(block.createdAt).toBeGreaterThanOrEqual(before)
      expect(block.updatedAt).toBe(block.createdAt)
      await expect(database.getDomainBlockById(block.id)).resolves.toEqual(
        block
      )
      expect(await readRules()).toHaveLength(1)
    })

    it('stores every setting it is given', async () => {
      const block = await database.createDomainBlock({
        domain: '*.Wild.test',
        severity: 'silence',
        rejectMedia: true,
        rejectReports: true,
        privateComment: 'private',
        publicComment: 'public',
        obfuscate: true,
        source: 'list'
      })

      expect(block).toMatchObject({
        domain: '*.wild.test',
        severity: 'silence',
        rejectMedia: true,
        rejectReports: true,
        privateComment: 'private',
        publicComment: 'public',
        obfuscate: true,
        source: 'list'
      })
    })

    it('rejects an invalid domain without storing anything', async () => {
      await expect(
        database.createDomainBlock({ domain: 'not a domain' })
      ).rejects.toThrow('Invalid domain')
      await expect(database.createDomainBlock({ domain: '' })).rejects.toThrow(
        'Invalid domain'
      )
      expect(await readRules()).toEqual([])
    })

    it('overwrites the settings of the block already stored for the domain', async () => {
      await seedRules([
        {
          type: 'block',
          domain: 'again.test',
          severity: 'suspend',
          rejectMedia: true,
          rejectReports: true,
          privateComment: 'old private',
          publicComment: 'old public',
          obfuscate: true,
          source: 'old source',
          createdAt: at(10),
          updatedAt: at(20)
        },
        { type: 'block', domain: 'neighbour.test' },
        // The same domain as an allow is a different rule.
        { type: 'allow', domain: 'again.test' }
      ])
      const before = Date.now()

      const block = await database.createDomainBlock({
        domain: 'AGAIN.test',
        severity: 'silence'
      })

      expect(block).toEqual({
        id: 'block-again.test',
        domain: 'again.test',
        type: 'block',
        severity: 'silence',
        rejectMedia: false,
        rejectReports: false,
        privateComment: null,
        publicComment: null,
        obfuscate: false,
        source: null,
        createdAt: at(10).getTime(),
        updatedAt: expect.any(Number)
      })
      expect(block.updatedAt).toBeGreaterThanOrEqual(before)

      const rules = await readRules()
      expect(rules.map((rule) => `${rule.type}:${rule.domain}`)).toEqual([
        'allow:again.test',
        'block:again.test',
        'block:neighbour.test'
      ])
      expect(rules[0]).toMatchObject({
        id: 'allow-again.test',
        severity: null,
        updatedAt: at(0).getTime()
      })
      expect(rules[2]).toMatchObject({
        id: 'block-neighbour.test',
        severity: 'suspend',
        updatedAt: at(0).getTime()
      })
    })

    it('creates a block next to an allow for the same domain', async () => {
      await seedRules([{ type: 'allow', domain: 'both.test' }])

      const block = await database.createDomainBlock({ domain: 'both.test' })

      expect(block.type).toBe('block')
      expect(block.id).not.toBe('allow-both.test')
      expect(await readRules()).toHaveLength(2)
      await expect(
        database.getDomainAllowById('allow-both.test')
      ).resolves.toEqual(allowOf('both.test'))
    })
  })

  describe('updateDomainBlock', () => {
    const seedBlockToUpdate = () =>
      seedRules([
        {
          type: 'block',
          domain: 'target.test',
          severity: 'suspend',
          rejectMedia: true,
          rejectReports: true,
          privateComment: 'private',
          publicComment: 'public',
          obfuscate: true,
          source: 'list',
          createdAt: at(10),
          updatedAt: at(20)
        },
        {
          type: 'block',
          domain: 'neighbour.test',
          rejectMedia: true,
          privateComment: 'untouched'
        },
        { type: 'allow', domain: 'target.test' }
      ])

    it('changes only the settings it is given', async () => {
      await seedBlockToUpdate()
      const before = Date.now()

      const updated = await database.updateDomainBlock({
        id: 'block-target.test',
        severity: 'silence',
        rejectReports: false
      })

      expect(updated).toEqual({
        id: 'block-target.test',
        domain: 'target.test',
        type: 'block',
        severity: 'silence',
        rejectMedia: true,
        rejectReports: false,
        privateComment: 'private',
        publicComment: 'public',
        obfuscate: true,
        source: 'list',
        createdAt: at(10).getTime(),
        updatedAt: expect.any(Number)
      })
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(before)
      await expect(
        database.getDomainBlockById('block-target.test')
      ).resolves.toEqual(updated)
    })

    it('sets a flag to false and clears a comment or the source with null', async () => {
      await seedBlockToUpdate()

      const updated = await database.updateDomainBlock({
        id: 'block-target.test',
        rejectMedia: false,
        obfuscate: false,
        privateComment: null,
        publicComment: null,
        source: null
      })

      expect(updated).toMatchObject({
        severity: 'suspend',
        rejectMedia: false,
        rejectReports: true,
        obfuscate: false,
        privateComment: null,
        publicComment: null,
        source: null
      })
    })

    it('leaves the other rules alone', async () => {
      await seedBlockToUpdate()
      const rulesBefore = await readRules()

      await database.updateDomainBlock({
        id: 'block-target.test',
        severity: 'noop',
        rejectMedia: false,
        privateComment: 'changed'
      })

      const rulesAfter = await readRules()
      expect(rulesAfter.map((rule) => rule.id)).toEqual(
        rulesBefore.map((rule) => rule.id)
      )
      for (const id of ['allow-target.test', 'block-neighbour.test']) {
        expect(rulesAfter.find((rule) => rule.id === id)).toEqual(
          rulesBefore.find((rule) => rule.id === id)
        )
      }
    })

    it('returns null for an allow or an unknown id and changes nothing', async () => {
      await seedBlockToUpdate()
      const rulesBefore = await readRules()

      await expect(
        database.updateDomainBlock({
          id: 'allow-target.test',
          severity: 'noop'
        })
      ).resolves.toBeNull()
      await expect(
        database.updateDomainBlock({ id: 'missing', severity: 'noop' })
      ).resolves.toBeNull()

      expect(await readRules()).toEqual(rulesBefore)
    })
  })

  describe('deleteDomainBlock and deleteDomainAllow', () => {
    const seedForDelete = () =>
      seedRules([
        { type: 'block', domain: 'one.test', severity: 'silence' },
        { type: 'block', domain: 'two.test' },
        { type: 'allow', domain: 'one.test' },
        { type: 'allow', domain: 'two.test' }
      ])

    it('deleteDomainBlock removes the block and returns it', async () => {
      await seedForDelete()

      await expect(
        database.deleteDomainBlock('block-one.test')
      ).resolves.toEqual(blockOf('one.test', { severity: 'silence' }))

      expect((await readRules()).map((rule) => rule.id)).toEqual([
        'allow-one.test',
        'allow-two.test',
        'block-two.test'
      ])
      await expect(
        database.deleteDomainBlock('block-one.test')
      ).resolves.toBeNull()
    })

    it('deleteDomainAllow removes the allow and returns it', async () => {
      await seedForDelete()

      await expect(
        database.deleteDomainAllow('allow-two.test')
      ).resolves.toEqual(allowOf('two.test'))

      expect((await readRules()).map((rule) => rule.id)).toEqual([
        'allow-one.test',
        'block-one.test',
        'block-two.test'
      ])
      await expect(
        database.deleteDomainAllow('allow-two.test')
      ).resolves.toBeNull()
    })

    it('each leaves a rule of the other type and unknown ids alone', async () => {
      await seedForDelete()
      const rulesBefore = await readRules()

      await expect(
        database.deleteDomainBlock('allow-one.test')
      ).resolves.toBeNull()
      await expect(
        database.deleteDomainAllow('block-one.test')
      ).resolves.toBeNull()
      await expect(database.deleteDomainBlock('missing')).resolves.toBeNull()
      await expect(database.deleteDomainAllow('missing')).resolves.toBeNull()

      expect(await readRules()).toEqual(rulesBefore)
    })
  })

  describe('createDomainAllow', () => {
    it('stores an allow for the normalized domain with no block settings', async () => {
      const before = Date.now()

      const allow = await database.createDomainAllow({
        domain: 'https://Friend.Example.test/path'
      })

      expect(allow).toEqual({
        id: expect.any(String),
        domain: 'friend.example.test',
        type: 'allow',
        createdAt: expect.any(Number),
        updatedAt: allow.createdAt
      })
      expect(allow.createdAt).toBeGreaterThanOrEqual(before)
      expect(await readRules()).toEqual([
        {
          id: allow.id,
          domain: 'friend.example.test',
          type: 'allow',
          severity: null,
          rejectMedia: false,
          rejectReports: false,
          privateComment: null,
          publicComment: null,
          obfuscate: false,
          source: null,
          createdAt: allow.createdAt,
          updatedAt: allow.updatedAt
        }
      ])
    })

    it('returns the allow that is already stored for the domain', async () => {
      await seedRules([
        { type: 'allow', domain: 'friend.test', createdAt: at(10) },
        { type: 'allow', domain: 'other.test' }
      ])

      await expect(
        database.createDomainAllow({ domain: 'FRIEND.test' })
      ).resolves.toEqual({
        ...allowOf('friend.test'),
        createdAt: at(10).getTime()
      })

      expect(await readRules()).toHaveLength(2)
    })

    it('creates an allow next to a block for the same domain', async () => {
      await seedRules([
        { type: 'block', domain: 'both.test', severity: 'silence' }
      ])

      const allow = await database.createDomainAllow({ domain: 'both.test' })

      expect(allow.type).toBe('allow')
      expect(allow.id).not.toBe('block-both.test')
      expect(await readRules()).toHaveLength(2)
      await expect(
        database.getDomainBlockById('block-both.test')
      ).resolves.toEqual(blockOf('both.test', { severity: 'silence' }))
    })

    it('rejects an invalid domain without storing anything', async () => {
      await expect(
        database.createDomainAllow({ domain: 'not a domain' })
      ).rejects.toThrow('Invalid domain')
      expect(await readRules()).toEqual([])
    })
  })

  describe('importDomainBlocks', () => {
    it('creates new blocks and overwrites the settings of existing ones', async () => {
      await seedRules([
        {
          type: 'block',
          domain: 'existing.test',
          severity: 'noop',
          rejectMedia: true,
          rejectReports: true,
          privateComment: 'old private',
          publicComment: 'old public',
          obfuscate: true,
          source: 'old source',
          createdAt: at(10),
          updatedAt: at(20)
        },
        { type: 'block', domain: 'untouched.test', publicComment: 'keep' },
        { type: 'allow', domain: 'allowed.test' },
        { type: 'allow', domain: 'existing.test' }
      ])
      const before = Date.now()

      const result = await database.importDomainBlocks({
        blocks: [
          { domain: 'existing.test', severity: 'silence' },
          {
            domain: 'https://New.test/path',
            severity: 'noop',
            rejectMedia: true,
            rejectReports: true,
            privateComment: 'private',
            publicComment: 'public',
            obfuscate: true,
            source: 'list'
          },
          // Blocked next to an allow, so a new block.
          { domain: 'allowed.test' },
          { domain: 'not a domain' },
          { domain: '' }
        ]
      })

      expect(result).toEqual({ created: 2, updated: 1, skipped: 2 })

      const rules = await readRules()
      expect(rules.map((rule) => `${rule.type}:${rule.domain}`)).toEqual([
        'allow:allowed.test',
        'allow:existing.test',
        'block:allowed.test',
        'block:existing.test',
        'block:new.test',
        'block:untouched.test'
      ])
      const byKey = Object.fromEntries(
        rules.map((rule) => [`${rule.type}:${rule.domain}`, rule])
      )
      expect(byKey['block:existing.test']).toEqual({
        id: 'block-existing.test',
        domain: 'existing.test',
        type: 'block',
        severity: 'silence',
        rejectMedia: false,
        rejectReports: false,
        privateComment: null,
        publicComment: null,
        obfuscate: false,
        source: null,
        createdAt: at(10).getTime(),
        updatedAt: expect.any(Number)
      })
      expect(byKey['block:existing.test'].updatedAt).toBeGreaterThanOrEqual(
        before
      )
      expect(byKey['block:new.test']).toMatchObject({
        severity: 'noop',
        rejectMedia: true,
        rejectReports: true,
        privateComment: 'private',
        publicComment: 'public',
        obfuscate: true,
        source: 'list'
      })
      expect(byKey['block:new.test'].createdAt).toBeGreaterThanOrEqual(before)
      expect(byKey['block:allowed.test']).toMatchObject({
        severity: 'suspend',
        rejectMedia: false
      })
      expect(byKey['block:untouched.test']).toMatchObject({
        id: 'block-untouched.test',
        publicComment: 'keep',
        updatedAt: at(0).getTime()
      })
      // The allows are as they were.
      expect(byKey['allow:existing.test']).toMatchObject({
        id: 'allow-existing.test',
        severity: null,
        updatedAt: at(0).getTime()
      })
      expect(byKey['allow:allowed.test']).toMatchObject({
        id: 'allow-allowed.test',
        severity: null,
        updatedAt: at(0).getTime()
      })
    })

    it('keeps the last block listed for a domain', async () => {
      const result = await database.importDomainBlocks({
        blocks: [
          { domain: 'dup.test', severity: 'noop', source: 'first' },
          { domain: 'HTTPS://DUP.test/x', severity: 'silence', source: 'last' }
        ]
      })

      expect(result).toEqual({ created: 1, updated: 0, skipped: 0 })
      const rules = await readRules()
      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatchObject({
        domain: 'dup.test',
        severity: 'silence',
        source: 'last'
      })
    })

    it('writes nothing when there is nothing valid to import', async () => {
      await seedRules([{ type: 'block', domain: 'existing.test' }])
      const rulesBefore = await readRules()

      await expect(
        database.importDomainBlocks({ blocks: [] })
      ).resolves.toEqual({ created: 0, updated: 0, skipped: 0 })
      await expect(
        database.importDomainBlocks({
          blocks: [{ domain: 'not a domain' }, { domain: '  ' }]
        })
      ).resolves.toEqual({ created: 0, updated: 0, skipped: 2 })

      expect(await readRules()).toEqual(rulesBefore)
    })

    it('counts the existing blocks wherever they sit in a long list', async () => {
      const domains = Array.from(
        { length: 1200 },
        (_, index) => `import-${index}.bulk.test`
      )
      const existing = [domains[0], domains[600], domains[1199]]
      await seedRules([
        ...existing.map((domain) => ({
          type: 'block' as const,
          domain,
          severity: 'noop'
        })),
        // Not blocks, so the same domains are still new ones.
        { type: 'allow', domain: domains[1] },
        { type: 'allow', domain: domains[1100] }
      ])

      const result = await database.importDomainBlocks({
        blocks: domains.map((domain) => ({ domain, source: 'bulk' }))
      })

      expect(result).toEqual({ created: 1197, updated: 3, skipped: 0 })
      const rules = await readRules()
      const blocks = rules.filter((rule) => rule.type === 'block')
      expect(blocks).toHaveLength(1200)
      expect(blocks.every((rule) => rule.source === 'bulk')).toBe(true)
      expect(blocks.every((rule) => rule.severity === 'suspend')).toBe(true)
      expect(rules.filter((rule) => rule.type === 'allow')).toHaveLength(2)
      expect(
        blocks.filter((rule) => rule.id === `block-${rule.domain}`)
      ).toHaveLength(3)
    })

    it('rolls everything back when a later batch fails', async () => {
      await seedRules([
        { type: 'block', domain: 'keep.test', severity: 'noop' },
        { type: 'allow', domain: 'poison.test' }
      ])
      const rulesBefore = await readRules()
      // A block for poison.test makes the database reject the insert, in the
      // last of several batches.
      const trigger =
        testDb.backend === 'pg'
          ? {
              create: [
                `CREATE FUNCTION reject_poison_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'block' AND NEW.domain = 'poison.test' THEN RAISE EXCEPTION 'poisoned block'; END IF; RETURN NEW; END $$`,
                `CREATE TRIGGER reject_poison_block BEFORE INSERT ON domain_federation_rules FOR EACH ROW EXECUTE FUNCTION reject_poison_block()`
              ],
              drop: [
                `DROP TRIGGER reject_poison_block ON domain_federation_rules`,
                `DROP FUNCTION reject_poison_block()`
              ]
            }
          : {
              create: [
                `CREATE TRIGGER reject_poison_block BEFORE INSERT ON domain_federation_rules WHEN NEW.type = 'block' AND NEW.domain = 'poison.test' BEGIN SELECT RAISE(ABORT, 'poisoned block'); END`
              ],
              drop: [`DROP TRIGGER reject_poison_block`]
            }
      for (const statement of trigger.create) {
        await sql.raw(statement).execute(testDb.db)
      }
      try {
        await expect(
          database.importDomainBlocks({
            blocks: [
              { domain: 'keep.test', severity: 'suspend' },
              ...Array.from({ length: 700 }, (_, index) => ({
                domain: `rollback-${index}.test`
              })),
              { domain: 'poison.test' }
            ]
          })
        ).rejects.toThrow('poisoned block')
      } finally {
        for (const statement of trigger.drop) {
          await sql.raw(statement).execute(testDb.db)
        }
      }

      expect(await readRules()).toEqual(rulesBefore)
    })
  })
})
