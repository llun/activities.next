import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

const withFreshDatabase = async (
  test: (database: Database) => Promise<void>
) => {
  const database = getTestSQLDatabase()
  await database.migrate()
  try {
    await test(database)
  } finally {
    await database.destroy()
  }
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

describe('createInstanceRule', () => {
  it('creates a rule with the provided text, hint and position', async () => {
    await withFreshDatabase(async (database) => {
      const rule = await database.createInstanceRule({
        text: 'Be excellent to each other',
        hint: 'No harassment of any kind',
        position: 3
      })

      expect(rule.id).toBeTruthy()
      expect(rule.text).toBe('Be excellent to each other')
      expect(rule.hint).toBe('No harassment of any kind')
      expect(rule.position).toBe(3)
      expect(typeof rule.createdAt).toBe('number')
      expect(typeof rule.updatedAt).toBe('number')

      const rules = await database.getInstanceRules()
      expect(rules).toEqual([rule])
    })
  })

  it('defaults position to 0 when not provided', async () => {
    await withFreshDatabase(async (database) => {
      const rule = await database.createInstanceRule({
        text: 'No spam',
        hint: ''
      })
      expect(rule.position).toBe(0)

      const rules = await database.getInstanceRules()
      expect(rules[0].position).toBe(0)
    })
  })
})

describe('getInstanceRules', () => {
  it('returns an empty list when no rules exist', async () => {
    await withFreshDatabase(async (database) => {
      expect(await database.getInstanceRules()).toEqual([])
    })
  })

  it('returns all rules ordered by position ascending', async () => {
    await withFreshDatabase(async (database) => {
      await database.createInstanceRule({
        text: 'Third rule',
        hint: '',
        position: 2
      })
      await database.createInstanceRule({
        text: 'First rule',
        hint: '',
        position: 0
      })
      await database.createInstanceRule({
        text: 'Second rule',
        hint: '',
        position: 1
      })

      const rules = await database.getInstanceRules()
      expect(rules.map((rule) => rule.text)).toEqual([
        'First rule',
        'Second rule',
        'Third rule'
      ])
      expect(rules.map((rule) => rule.position)).toEqual([0, 1, 2])
    })
  })

  it('breaks position ties by createdAt ascending', async () => {
    await withFreshDatabase(async (database) => {
      await database.createInstanceRule({
        text: 'Older rule',
        hint: '',
        position: 1
      })
      // SQLite stores timestamps at millisecond precision — make sure the
      // second rule's createdAt is strictly later.
      await sleep(10)
      await database.createInstanceRule({
        text: 'Newer rule',
        hint: '',
        position: 1
      })

      const rules = await database.getInstanceRules()
      expect(rules.map((rule) => rule.text)).toEqual([
        'Older rule',
        'Newer rule'
      ])
    })
  })
})

describe('updateInstanceRule', () => {
  it.each([
    {
      description: 'updates only the text when only text is provided',
      update: { text: 'Updated text' },
      expected: { text: 'Updated text', hint: 'Original hint', position: 1 }
    },
    {
      description: 'updates only the hint when only hint is provided',
      update: { hint: 'Updated hint' },
      expected: { text: 'Original text', hint: 'Updated hint', position: 1 }
    },
    {
      description: 'updates only the position when only position is provided',
      update: { position: 5 },
      expected: { text: 'Original text', hint: 'Original hint', position: 5 }
    },
    {
      description: 'moves the rule to position 0 when position 0 is provided',
      update: { position: 0 },
      expected: { text: 'Original text', hint: 'Original hint', position: 0 }
    },
    {
      description: 'clears the hint when an empty hint is provided',
      update: { hint: '' },
      expected: { text: 'Original text', hint: '', position: 1 }
    },
    {
      description: 'updates every field when all fields are provided',
      update: { text: 'Updated text', hint: 'Updated hint', position: 9 },
      expected: { text: 'Updated text', hint: 'Updated hint', position: 9 }
    }
  ])('$description', async ({ update, expected }) => {
    await withFreshDatabase(async (database) => {
      const created = await database.createInstanceRule({
        text: 'Original text',
        hint: 'Original hint',
        position: 1
      })

      // SQLite stores timestamps at millisecond precision — make sure the
      // update lands on a strictly later updatedAt.
      await sleep(10)
      const updated = await database.updateInstanceRule({
        id: created.id,
        ...update
      })

      expect(updated).not.toBeNull()
      expect(updated).toEqual(
        expect.objectContaining({ id: created.id, ...expected })
      )
      expect(updated?.createdAt).toBe(created.createdAt)
      expect(updated?.updatedAt).toBeGreaterThan(created.updatedAt)

      const rules = await database.getInstanceRules()
      expect(rules).toEqual([updated])
    })
  })

  it('returns null for an unknown id', async () => {
    await withFreshDatabase(async (database) => {
      const updated = await database.updateInstanceRule({
        id: 'unknown-rule-id',
        text: 'Does not matter'
      })
      expect(updated).toBeNull()
    })
  })
})

describe('deleteInstanceRule', () => {
  it('removes the rule', async () => {
    await withFreshDatabase(async (database) => {
      const keep = await database.createInstanceRule({
        text: 'Keep this rule',
        hint: '',
        position: 0
      })
      const remove = await database.createInstanceRule({
        text: 'Remove this rule',
        hint: '',
        position: 1
      })

      await database.deleteInstanceRule({ id: remove.id })

      const rules = await database.getInstanceRules()
      expect(rules).toEqual([keep])
    })
  })
})
