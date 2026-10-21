import { NextRequest } from 'next/server'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { urlToId } from '@/lib/utils/urlToId'

import { POST } from './route'

let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    host: 'llun.test',
    trustedHosts: ['club.llun.test', 'other.llun.test'],
    secretPhase: 'test-secret',
    allowEmails: []
  })
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: vi.fn().mockResolvedValue(undefined) })
}))

// The guard is out of scope here: it hands the route the real test database
// and the reporting actor.
vi.mock('@/lib/services/guards/OAuthGuard', () => ({
  OAuthGuard:
    (
      _scopes: unknown,
      handle: (
        req: NextRequest,
        context: {
          database: unknown
          currentActor: unknown
          params: Promise<unknown>
        }
      ) => Promise<Response> | Response
    ) =>
    (req: NextRequest, context: { params: Promise<unknown> }) =>
      handle(req, {
        database: mockDatabase,
        currentActor: { id: ACTOR1_ID, domain: 'llun.test' },
        params: context.params
      })
}))

describe('POST /api/v1/reports rules and domain', () => {
  const database = getTestSQLDatabase()
  let serverRuleId: string
  let clubRuleId: string
  let otherRuleId: string

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    serverRuleId = (
      await database.createInstanceRule({ text: 'Server rule', hint: '' })
    ).id
    clubRuleId = (
      await database.createInstanceRule({
        domain: 'club.llun.test',
        text: 'Club rule',
        hint: ''
      })
    ).id
    otherRuleId = (
      await database.createInstanceRule({
        domain: 'other.llun.test',
        text: 'Other rule',
        hint: ''
      })
    ).id
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  const report = (host: string, ruleIds: string[]) =>
    POST(
      new NextRequest('https://llun.test/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host },
        body: JSON.stringify({
          account_id: urlToId(ACTOR2_ID),
          category: 'violation',
          rule_ids: ruleIds
        })
      }),
      { params: Promise.resolve({}) }
    )

  it('accepts the server rules and the visited domain’s own rules', async () => {
    const response = await report('club.llun.test', [serverRuleId, clubRuleId])

    expect(response.status).toBe(200)
    const reports = await database.getAdminReports({})
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      actorId: ACTOR1_ID,
      targetActorId: ACTOR2_ID,
      ruleIds: [serverRuleId, clubRuleId],
      // The reported profile's domain, not the host the report came from.
      domain: 'llun.test'
    })
  })

  it('forces the violation category when rules are cited', async () => {
    const response = await POST(
      new NextRequest('https://llun.test/api/v1/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'llun.test' },
        body: JSON.stringify({
          account_id: urlToId(ACTOR2_ID),
          category: 'spam',
          rule_ids: [serverRuleId]
        })
      }),
      { params: Promise.resolve({}) }
    )
    expect(response.status).toBe(200)
    expect((await response.json()).category).toBe('violation')
  })

  it('refuses a rule that is not visible on the visited host', async () => {
    const before = (await database.getAdminReports({})).length

    for (const [host, ruleIds] of [
      ['club.llun.test', [otherRuleId]],
      ['llun.test', [clubRuleId]],
      ['evil.example', [clubRuleId]],
      ['club.llun.test', [serverRuleId, 'no-such-rule']]
    ] as const) {
      const response = await report(host, [...ruleIds])
      expect(response.status).toBe(422)
      await expect(response.json()).resolves.toEqual({
        error: 'Validation failed: Rule ids does not reference valid rules'
      })
    }

    expect(await database.getAdminReports({})).toHaveLength(before)
  })

  it('files a report without rules on any host', async () => {
    const before = (await database.getAdminReports({})).length

    const response = await report('llun.test', [])

    expect(response.status).toBe(200)
    expect(await database.getAdminReports({})).toHaveLength(before + 1)
  })
})
