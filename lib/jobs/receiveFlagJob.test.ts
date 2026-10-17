import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { RECEIVE_FLAG_JOB_NAME } from '@/lib/jobs/names'
import { receiveFlagJob } from '@/lib/jobs/receiveFlagJob'
import { serializeAdminReports } from '@/lib/services/admin/serializeAdminReports'
import { seedDatabase } from '@/lib/stub/database'
import { FEDIVERSE_ACTORS, mockFediverseRequests } from '@/lib/stub/fediverse'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { ACTOR2_ID } from '@/lib/stub/seed/actor2'
import { ACTOR3_ID } from '@/lib/stub/seed/actor3'

enableFetchMocks()

const INSTANCE_ACTOR = 'https://mastodon.example/actor'
const MISSKEY_ACTOR = 'https://misskey.test/users/9tjwl4bvxw'
const LOCAL_POST = `${ACTOR1_ID}/statuses/post-1`

describe('receiveFlagJob', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockFediverseRequests(fetchMock)
  })

  const run = (data: unknown, verifiedSenderActorId = INSTANCE_ACTOR) =>
    receiveFlagJob(database, {
      id: 'job-1',
      name: RECEIVE_FLAG_JOB_NAME,
      data,
      verifiedSenderActorId
    })

  const reportsFrom = (accountId: string) =>
    database.getAdminReports({ accountId })

  it('files a report from the instance actor against a local account and status', async () => {
    await run({
      id: 'https://mastodon.example/flag-1',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID, LOCAL_POST],
      content: 'Spam links'
    })

    const reports = await reportsFrom(INSTANCE_ACTOR)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      actorId: INSTANCE_ACTOR,
      targetActorId: ACTOR1_ID,
      category: 'other',
      comment: 'Spam links',
      statusIds: [LOCAL_POST],
      actionTaken: false
    })
    // The reporter is recorded, so the admin report can show it.
    expect(await database.getActorFromId({ id: INSTANCE_ACTOR })).toMatchObject(
      { id: INSTANCE_ACTOR }
    )
  })

  it('files an account-only report from a Misskey user', async () => {
    await run(
      {
        id: 'https://misskey.test/flags/1',
        actor: MISSKEY_ACTOR,
        object: [ACTOR1_ID],
        content: 'Harassment in replies'
      },
      MISSKEY_ACTOR
    )

    const reports = await reportsFrom(MISSKEY_ACTOR)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      targetActorId: ACTOR1_ID,
      comment: 'Harassment in replies',
      statusIds: []
    })
  })

  it('ignores a Flag that names no local account', async () => {
    await run({
      id: 'https://mastodon.example/flag-remote',
      actor: INSTANCE_ACTOR,
      object: ['https://misskey.test/users/9tjwl4bvxw'],
      content: 'not ours'
    })
    await run({
      id: 'https://mastodon.example/flag-unknown',
      actor: INSTANCE_ACTOR,
      object: ['https://llun.test/users/nobody'],
      content: 'unknown'
    })

    const comments = (await reportsFrom(INSTANCE_ACTOR)).map((r) => r.comment)
    expect(comments).not.toContain('not ours')
    expect(comments).not.toContain('unknown')
  })

  it('keeps only local statuses owned by the reported account', async () => {
    await run({
      id: 'https://mastodon.example/flag-statuses',
      actor: INSTANCE_ACTOR,
      object: [
        ACTOR1_ID,
        'https://misskey.test/notes/remote-1',
        'https://llun.test/users/test1/statuses/does-not-exist'
      ],
      content: 'only the account'
    })

    const report = (await reportsFrom(INSTANCE_ACTOR)).find(
      (r) => r.comment === 'only the account'
    )
    expect(report?.statusIds).toEqual([])
  })

  it('does not file a second identical open report on redelivery', async () => {
    const data = {
      id: 'https://mastodon.example/flag-dupe',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID],
      content: 'dupe check'
    }
    await run(data)
    await run(data)

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === 'dupe check'
    )
    expect(matching).toHaveLength(1)
  })

  it('ignores a Flag whose actor is not the verified signer', async () => {
    await run(
      {
        id: 'https://mastodon.example/flag-forged',
        actor: INSTANCE_ACTOR,
        object: [ACTOR1_ID],
        content: 'forged'
      },
      'https://evil.test/users/mallory'
    )

    const comments = (await reportsFrom(INSTANCE_ACTOR)).map((r) => r.comment)
    expect(comments).not.toContain('forged')
  })

  it('keeps up to 5000 characters of the comment', async () => {
    await run({
      id: 'https://mastodon.example/flag-long',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID],
      content: 'x'.repeat(1500)
    })

    const longest = (await reportsFrom(INSTANCE_ACTOR)).find((r) =>
      r.comment.startsWith('xxx')
    )
    expect(longest?.comment).toHaveLength(1500)

    await run({
      id: 'https://mastodon.example/flag-longer',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID],
      content: 'y'.repeat(6000)
    })
    const capped = (await reportsFrom(INSTANCE_ACTOR)).find((r) =>
      r.comment.startsWith('yyy')
    )
    expect(capped?.comment).toHaveLength(5000)
  })

  it('ignores malformed job data', async () => {
    await expect(run({ nope: true })).resolves.toBeUndefined()
  })

  it.each([
    ['noop', 'noop-reject'],
    ['silence', 'silence-reject']
  ] as const)(
    'ignores a reporter on a %s domain block that rejects reports',
    async (severity, comment) => {
      const block = await database.createDomainBlock({
        domain: 'mastodon.example',
        severity,
        rejectReports: true
      })
      try {
        await run({
          id: `https://mastodon.example/flag-${comment}`,
          actor: INSTANCE_ACTOR,
          object: [ACTOR1_ID],
          content: comment
        })
        const comments = (await reportsFrom(INSTANCE_ACTOR)).map(
          (r) => r.comment
        )
        expect(comments).not.toContain(comment)
      } finally {
        await database.deleteDomainBlock(block.id)
      }

      // Without the block the same Flag is filed.
      await run({
        id: `https://mastodon.example/flag-${comment}`,
        actor: INSTANCE_ACTOR,
        object: [ACTOR1_ID],
        content: comment
      })
      const comments = (await reportsFrom(INSTANCE_ACTOR)).map((r) => r.comment)
      expect(comments).toContain(comment)
    }
  )

  it('still files a report for a domain block that does not reject reports', async () => {
    const block = await database.createDomainBlock({
      domain: 'mastodon.example',
      severity: 'silence',
      rejectReports: false
    })
    try {
      await run({
        id: 'https://mastodon.example/flag-silenced',
        actor: INSTANCE_ACTOR,
        object: [ACTOR1_ID],
        content: 'silenced but allowed'
      })
    } finally {
      await database.deleteDomainBlock(block.id)
    }
    const comments = (await reportsFrom(INSTANCE_ACTOR)).map((r) => r.comment)
    expect(comments).toContain('silenced but allowed')
  })

  it('skips a suspended local account', async () => {
    await database.setActorSuspended({ actorId: ACTOR3_ID, suspended: true })
    try {
      await run({
        id: 'https://mastodon.example/flag-suspended',
        actor: INSTANCE_ACTOR,
        object: [ACTOR3_ID, ACTOR1_ID],
        content: 'suspended target'
      })
    } finally {
      await database.setActorSuspended({ actorId: ACTOR3_ID, suspended: false })
    }

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === 'suspended target'
    )
    expect(matching.map((r) => r.targetActorId)).toEqual([ACTOR1_ID])
  })

  it('files one report per local account, each with its own statuses', async () => {
    await run({
      id: 'https://mastodon.example/flag-multi',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID, ACTOR2_ID, LOCAL_POST],
      content: 'two accounts'
    })

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === 'two accounts'
    )
    expect(matching).toHaveLength(2)
    const byTarget = new Map(matching.map((r) => [r.targetActorId, r]))
    expect(byTarget.get(ACTOR1_ID)?.statusIds).toEqual([LOCAL_POST])
    expect(byTarget.get(ACTOR2_ID)?.statusIds).toEqual([])
  })

  it('finds the accounts even behind many status ids', async () => {
    const statuses = Array.from(
      { length: 120 },
      (_, i) => `https://mastodon.example/notes/${i}`
    )
    await run({
      id: 'https://mastodon.example/flag-many',
      actor: INSTANCE_ACTOR,
      object: [...statuses, ACTOR1_ID],
      content: 'accounts after statuses'
    })

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === 'accounts after statuses'
    )
    expect(matching.map((r) => r.targetActorId)).toEqual([ACTOR1_ID])
  })

  it('caps one Flag at 20 reported accounts', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const ids: string[] = []
    for (let i = 0; i < 25; i += 1) {
      const username = `cap${i}-${tag}`
      await database.createAccount({
        email: `${username}@llun.test`,
        username,
        passwordHash: 'hash',
        domain: 'llun.test',
        privateKey: `private-${username}`,
        publicKey: `public-${username}`
      })
      ids.push(`https://llun.test/users/${username}`)
    }

    await run({
      id: `https://mastodon.example/flag-cap-${tag}`,
      actor: INSTANCE_ACTOR,
      object: ids,
      content: `cap ${tag}`
    })

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === `cap ${tag}`
    )
    expect(matching).toHaveLength(20)
    expect(matching.map((r) => r.targetActorId).sort()).toEqual(
      ids.slice(0, 20).sort()
    )
  })

  it('stores the reporter under its canonical actor id', async () => {
    const tag = crypto.randomUUID().slice(0, 8)
    const aliased = `${INSTANCE_ACTOR}/`
    // The alias serves the instance actor's document, whose id has no slash.
    fetchMock.mockResponse(async (req) =>
      req.url === aliased
        ? {
            status: 200,
            headers: { 'content-type': 'application/activity+json' },
            body: JSON.stringify(FEDIVERSE_ACTORS.mastodonInstance)
          }
        : { status: 404, body: '' }
    )
    const data = {
      id: `https://mastodon.example/flag-canonical-${tag}`,
      actor: aliased,
      object: [ACTOR1_ID],
      content: `canonical ${tag}`
    }
    await run(data, aliased)
    await run(data, aliased)

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === `canonical ${tag}`
    )
    // Filed under the recorded row's id, and the retry is still deduplicated.
    expect(matching).toHaveLength(1)
    expect(matching[0].actorId).toBe(INSTANCE_ACTOR)
    expect(await reportsFrom(aliased)).toEqual([])
  })

  it('does not file a report against the federation signing actor', async () => {
    const signer = await database.getFederationSigningActor()
    expect(signer).not.toBeNull()
    const tag = crypto.randomUUID().slice(0, 8)

    await run({
      id: `https://mastodon.example/flag-signer-${tag}`,
      actor: INSTANCE_ACTOR,
      object: [signer!.id, ACTOR1_ID],
      content: `signer ${tag}`
    })

    const matching = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === `signer ${tag}`
    )
    expect(matching.map((r) => r.targetActorId)).toEqual([ACTOR1_ID])
  })

  it('serializes a report filed by an Application instance actor', async () => {
    await run({
      id: 'https://mastodon.example/flag-serialize',
      actor: INSTANCE_ACTOR,
      object: [ACTOR1_ID, LOCAL_POST],
      content: 'serialize me'
    })
    const reports = (await reportsFrom(INSTANCE_ACTOR)).filter(
      (r) => r.comment === 'serialize me'
    )
    expect(reports).toHaveLength(1)

    const [serialized] = await serializeAdminReports(database, reports)
    expect(serialized).toBeDefined()
    expect(serialized.comment).toBe('serialize me')
    expect(serialized.category).toBe('other')
    expect(serialized.account.username).toBe('mastodon.example')
    expect(serialized.account.domain).toBe('mastodon.example')
    expect(serialized.target_account.username).toBe('test1')
    expect(serialized.statuses).toHaveLength(1)
  })
})
