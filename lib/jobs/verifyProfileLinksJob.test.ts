import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { verifyProfileLinksJob } from '@/lib/jobs/verifyProfileLinksJob'
import { verifyProfileLink } from '@/lib/services/profile-links/verifyProfileLink'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'

vi.mock('@/lib/services/profile-links/verifyProfileLink', () => ({
  verifyProfileLink: vi.fn()
}))

const mockedVerify = vi.mocked(verifyProfileLink)

const run = (
  database: ReturnType<typeof getTestSQLDatabase>,
  actorId: string
) =>
  verifyProfileLinksJob(database, {
    id: `verify-${actorId}`,
    name: VERIFY_PROFILE_LINKS_JOB_NAME,
    data: { actorId }
  })

describe('verifyProfileLinksJob', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    mockedVerify.mockReset()
  })

  it('verifies only the fields whose page links back', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      fields: [
        { name: 'Good', value: 'https://good.example' },
        { name: 'Bad', value: 'https://bad.example' },
        { name: 'Text', value: 'they/them' }
      ]
    })
    mockedVerify.mockImplementation(
      async ({ url }) => url === 'https://good.example'
    )

    await run(database, ACTOR1_ID)

    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.fields?.[0].verifiedAt).toEqual(expect.any(Number))
    expect(actor?.fields?.[1]).toEqual({
      name: 'Bad',
      value: 'https://bad.example'
    })
    expect(actor?.fields?.[2]).toEqual({ name: 'Text', value: 'they/them' })
    expect(mockedVerify).toHaveBeenCalledTimes(2)
  })

  it('checks the link back against the profile URL and the actor id', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      fields: [{ name: 'Blog', value: 'https://blog.example' }]
    })
    mockedVerify.mockResolvedValue(false)

    await run(database, ACTOR1_ID)

    expect(mockedVerify).toHaveBeenCalledWith({
      url: 'https://blog.example',
      linkBacks: ['https://llun.test/@test1', ACTOR1_ID]
    })
  })

  it('stamps linksCheckedAt whatever the outcome', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      fields: [{ name: 'Blog', value: 'https://nolink.example' }]
    })
    mockedVerify.mockResolvedValue(false)
    const before = Date.now()

    await run(database, ACTOR1_ID)

    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.fields?.[0].verifiedAt).toBeUndefined()
    expect(actor?.linksCheckedAt).toBeGreaterThanOrEqual(before)
    const account = await database.getMastodonActorFromId({ id: ACTOR1_ID })
    expect(JSON.stringify(account)).not.toContain('linksCheckedAt')
  })

  it('does not check a field that is already verified', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      fields: [{ name: 'Blog', value: 'https://done.example' }]
    })
    await database.markActorProfileFieldsVerified({
      actorId: ACTOR1_ID,
      values: ['https://done.example'],
      verifiedAt: 1700000000000,
      checkedAt: 1700000000000
    })

    await run(database, ACTOR1_ID)

    expect(mockedVerify).not.toHaveBeenCalled()
    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.fields?.[0].verifiedAt).toBe(1700000000000)
  })

  it('leaves a field edited while the page was fetched unverified', async () => {
    await database.updateActor({
      actorId: ACTOR1_ID,
      fields: [{ name: 'Blog', value: 'https://old.example' }]
    })
    mockedVerify.mockImplementation(async () => {
      // The owner saves a new value before the check answers.
      await database.updateActor({
        actorId: ACTOR1_ID,
        fields: [{ name: 'Blog', value: 'https://new.example' }]
      })
      return true
    })

    await run(database, ACTOR1_ID)

    const actor = await database.getActorFromId({ id: ACTOR1_ID })
    expect(actor?.fields).toEqual([
      { name: 'Blog', value: 'https://new.example' }
    ])
  })

  it('reads a remote actor value from its HTML', async () => {
    await database.updateActor({
      actorId: EXTERNAL_ACTOR1,
      fields: [
        {
          name: 'Web',
          value:
            '<a href="https://remote-blog.example/">https://remote-blog.example/</a>'
        },
        {
          name: 'Spoof',
          value: '<a href="https://evil.example/">https://good.example/</a>'
        }
      ]
    })
    mockedVerify.mockResolvedValue(true)

    await run(database, EXTERNAL_ACTOR1)

    expect(mockedVerify).toHaveBeenCalledTimes(1)
    expect(mockedVerify).toHaveBeenCalledWith({
      url: 'https://remote-blog.example/',
      linkBacks: ['https://llun.dev/@test1', EXTERNAL_ACTOR1]
    })
    const actor = await database.getActorFromId({ id: EXTERNAL_ACTOR1 })
    expect(actor?.fields?.[0].verifiedAt).toEqual(expect.any(Number))
    expect(actor?.fields?.[1].verifiedAt).toBeUndefined()
  })

  it('ignores an actor that is gone and malformed job data', async () => {
    await run(database, 'https://llun.test/users/nobody')
    await verifyProfileLinksJob(database, {
      id: 'verify-bad',
      name: VERIFY_PROFILE_LINKS_JOB_NAME,
      data: {}
    })

    expect(mockedVerify).not.toHaveBeenCalled()
  })
})
