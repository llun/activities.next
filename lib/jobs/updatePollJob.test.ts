import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { createPollJob } from '@/lib/jobs/createPollJob'
import { CREATE_POLL_JOB_NAME, UPDATE_POLL_JOB_NAME } from '@/lib/jobs/names'
import { updatePollJob } from '@/lib/jobs/updatePollJob'
import { mockRequests } from '@/lib/stub/activities'
import { seedDatabase } from '@/lib/stub/database'
import { ACTOR1_ID } from '@/lib/stub/seed/actor1'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

enableFetchMocks()

const REMOTE_ACTOR_ID = 'https://somewhere.test/actors/pollcreator'

interface QuestionOption {
  type: string
  name: string
  replies?: { type: string; totalItems: number }
}

const createOption = (name: string, votes = 0): QuestionOption => ({
  type: 'Note',
  name,
  replies: { type: 'Collection', totalItems: votes }
})

// What Mastodon sends for a `hide_totals` poll until it closes: no `replies`.
const createUntalliedOption = (name: string): QuestionOption => ({
  type: 'Note',
  name
})

const MockActivityPubQuestion = (
  id: string,
  options: {
    content?: string
    summary?: string | null
    published?: number
    endTime?: number
    // Mastodon's `updated` on an explicit edit; null omits it (an implicit
    // Update, e.g. a tally refresh). Defaults to the build time.
    updated?: number | null
    closed?: string | boolean
    oneOf?: QuestionOption[]
    anyOf?: QuestionOption[]
    includeTag?: boolean
    attributedTo?: string
  } = {}
) => {
  const {
    content = '<p>What is your favorite color?</p>',
    summary = null,
    published = Date.now(),
    endTime = Date.now() + 24 * 60 * 60 * 1000,
    updated = Date.now(),
    closed,
    oneOf,
    anyOf,
    includeTag = true,
    attributedTo = REMOTE_ACTOR_ID
  } = options

  // Determine poll options
  const pollOptions: { oneOf?: QuestionOption[]; anyOf?: QuestionOption[] } = {}
  if (anyOf !== undefined) {
    pollOptions.anyOf = anyOf
  } else if (oneOf !== undefined) {
    pollOptions.oneOf = oneOf
  } else {
    pollOptions.oneOf = [
      createOption('Red'),
      createOption('Blue'),
      createOption('Green')
    ]
  }

  const question = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id,
    type: 'Question',
    attributedTo,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${REMOTE_ACTOR_ID}/followers`],
    content,
    summary,
    published: getISOTimeUTC(published),
    endTime: getISOTimeUTC(endTime),
    ...(updated === null ? {} : { updated: getISOTimeUTC(updated) }),
    ...(closed === undefined ? {} : { closed }),
    inReplyTo: null,
    url: id,
    ...(includeTag ? { tag: [] } : {}),
    ...pollOptions
  }

  return question
}

describe('updatePollJob', () => {
  const { database, prepare } = createTestDatabase()

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    fetchMock.resetMocks()
    mockRequests(fetchMock)
  })

  it('updates poll vote counts', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Red', 0), createOption('Blue', 0)]
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    const updatedPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Red', 5), createOption('Blue', 3)]
    })

    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].totalVotes).toEqual(5)
    expect(status.choices[1].totalVotes).toEqual(3)
  })

  it('updates poll without tag field', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Option A', 0), createOption('Option B', 0)]
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    // Create update without tag field (simulating real ActivityPub payloads)
    const updatedPoll = MockActivityPubQuestion(pollId, {
      oneOf: [createOption('Option A', 10), createOption('Option B', 7)],
      includeTag: false // Don't include tag field at all
    })

    // This should not throw even though tag is missing
    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].totalVotes).toEqual(10)
    expect(status.choices[1].totalVotes).toEqual(7)
  })

  it('updates poll content', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      content: '<p>Original question</p>'
    })

    await createPollJob(database, {
      id: 'id',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    const updatedPoll = MockActivityPubQuestion(pollId, {
      content: '<p>Updated question</p>'
    })

    await updatePollJob(database, {
      id: 'id',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status?.text).toEqual('<p>Updated question</p>')
  })

  it('does not update non-existent poll', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/nonexistent`
    const poll = MockActivityPubQuestion(pollId)

    // Should not throw, just return early
    await expect(
      updatePollJob(database, {
        id: 'id',
        name: UPDATE_POLL_JOB_NAME,
        data: poll
      })
    ).resolves.not.toThrow()

    const status = await database.getStatus({ statusId: pollId })
    expect(status).toBeNull()
  })

  it('refuses an Update for a poll the sender does not own', async () => {
    // The inbox only proves the payload's `attributedTo` matches the signer,
    // which an attacker satisfies by attributing the Update to themselves while
    // pointing `id` at someone else's poll. Without an ownership check the
    // target is resolved by `question.id` alone and any federated actor can
    // rewrite the text and tallies of any stored poll, recording a
    // `status_history` revision that reads as a genuine edit by the victim.
    const pollId = `${REMOTE_ACTOR_ID}/questions/owned-${Date.now()}`
    await createPollJob(database, {
      id: 'id-owned-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Original question</p>',
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })

    await updatePollJob(database, {
      id: 'id-owned-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Defaced</p>',
        attributedTo: 'https://attacker.test/actors/bad',
        oneOf: [createOption('Red', 999), createOption('Blue', 999)]
      })
    })

    const status = await database.getStatus({ statusId: pollId })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.text).toEqual('<p>Original question</p>')
    expect(status.choices[0].totalVotes).toEqual(1)
    expect(status.choices[1].totalVotes).toEqual(2)
    expect(status.edits).toHaveLength(0)
  })

  it('accepts an Update whose author differs from the poll owner only by host casing', async () => {
    // The ownership check normalizes both actor ids, so a benign case
    // difference must not refuse a poll author's own edit.
    const pollId = `${REMOTE_ACTOR_ID}/questions/host-case-${Date.now()}`
    await createPollJob(database, {
      id: 'id-host-case-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Original question</p>',
        oneOf: [createOption('Red', 1)]
      })
    })

    await updatePollJob(database, {
      id: 'id-host-case-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Edited by the author</p>',
        attributedTo: 'https://SOMEWHERE.test/actors/pollcreator',
        oneOf: [createOption('Red', 4)]
      })
    })

    const status = await database.getStatus({ statusId: pollId })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.text).toEqual('<p>Edited by the author</p>')
    expect(status.choices[0].totalVotes).toEqual(4)
  })

  it('updates multiple-choice (anyOf) poll vote counts', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/multiple-${Date.now()}`
    const originalPoll = MockActivityPubQuestion(pollId, {
      anyOf: [createOption('Option 1', 0), createOption('Option 2', 0)]
    })

    await createPollJob(database, {
      id: 'id-anyof-create',
      name: CREATE_POLL_JOB_NAME,
      data: originalPoll
    })

    const updatedPoll = MockActivityPubQuestion(pollId, {
      anyOf: [createOption('Option 1', 15), createOption('Option 2', 20)]
    })

    await updatePollJob(database, {
      id: 'id-anyof-update',
      name: UPDATE_POLL_JOB_NAME,
      data: updatedPoll
    })

    const status = await database.getStatus({ statusId: pollId })
    if (status?.type !== StatusType.enum.Poll) {
      fail('Status type must be Poll')
    }
    expect(status.choices).toHaveLength(2)
    expect(status.choices[0].totalVotes).toEqual(15)
    expect(status.choices[1].totalVotes).toEqual(20)
  })

  it('moves the stored end time when the Update changes endTime', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/endtime-${Date.now()}`
    const originalEnd = Date.now() + 24 * 60 * 60 * 1000
    const extendedEnd = originalEnd + 48 * 60 * 60 * 1000
    await createPollJob(database, {
      id: 'id-endtime-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime: originalEnd })
    })

    await updatePollJob(database, {
      id: 'id-endtime-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime: extendedEnd })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.endAt).toEqual(new Date(getISOTimeUTC(extendedEnd)).getTime())
  })

  it('keeps stored tallies for options the Update sends without replies', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/untallied-${Date.now()}`
    await createPollJob(database, {
      id: 'id-untallied-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 5), createOption('Blue', 3)]
      })
    })

    await updatePollJob(database, {
      id: 'id-untallied-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Edited, totals hidden</p>',
        oneOf: [createUntalliedOption('Red'), createOption('Blue', 4)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.text).toEqual('<p>Edited, totals hidden</p>')
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([5, 4])
  })

  it('resets votes and takes the Update tallies when the option set changes', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/reset-${Date.now()}`
    await createPollJob(database, {
      id: 'id-reset-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    await database.recordPollVotes({
      statusId: pollId,
      actorId: ACTOR1_ID,
      choices: [0]
    })

    await updatePollJob(database, {
      id: 'id-reset-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        // Blue survives the edit but arrives untallied: on a reset its tally
        // comes from the Update (0), not from the stored row (2).
        oneOf: [
          createOption('Crimson', 7),
          createUntalliedOption('Blue'),
          createOption('Green', 3)
        ]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId,
      currentActorId: ACTOR1_ID
    })) as StatusPoll
    expect(status.choices.map((choice) => choice.title)).toEqual([
      'Crimson',
      'Blue',
      'Green'
    ])
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([7, 0, 3])
    expect(status.voted).toBe(false)
    expect(status.ownVotes).toEqual([])
    expect(status.votersCount).toBe(0)
  })

  it('switches pollType and resets votes when the Update changes oneOf to anyOf', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/mode-${Date.now()}`
    await createPollJob(database, {
      id: 'id-mode-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    await database.recordPollVotes({
      statusId: pollId,
      actorId: ACTOR1_ID,
      choices: [1]
    })

    await updatePollJob(database, {
      id: 'id-mode-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        anyOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId,
      currentActorId: ACTOR1_ID
    })) as StatusPoll
    expect(status.pollType).toEqual('anyOf')
    expect(status.voted).toBe(false)
    expect(status.ownVotes).toEqual([])
  })

  it('updates totals without resetting votes when the options are unchanged', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/keep-${Date.now()}`
    await createPollJob(database, {
      id: 'id-keep-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    await database.recordPollVotes({
      statusId: pollId,
      actorId: ACTOR1_ID,
      choices: [0]
    })

    await updatePollJob(database, {
      id: 'id-keep-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 9), createOption('Blue', 4)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId,
      currentActorId: ACTOR1_ID
    })) as StatusPoll
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([9, 4])
    expect(status.voted).toBe(true)
    expect(status.ownVotes).toEqual([0])
  })

  it('keeps the stored deadline and records no revision for an unparseable endTime', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/bad-endtime-${Date.now()}`
    const originalEnd = Date.now() + 24 * 60 * 60 * 1000
    await createPollJob(database, {
      id: 'id-bad-endtime-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime: originalEnd })
    })
    const before = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll

    // Two explicit Updates, each newer than the last, both with a bad endTime:
    // NaN must not be stored as null (hydrated as "expired at creation"), and a
    // redelivery must not keep adding revisions for an unchanged poll.
    for (const [index, updated] of [Date.now(), Date.now() + 1000].entries()) {
      await updatePollJob(database, {
        id: `id-bad-endtime-update-${index}`,
        name: UPDATE_POLL_JOB_NAME,
        data: {
          ...MockActivityPubQuestion(pollId, { updated }),
          endTime: 'not-a-date'
        }
      })
    }

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.endAt).toEqual(before.endAt)
    expect(status.edits).toHaveLength(0)
  })

  it('prefers a string closed over endTime as the deadline', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/closed-string-${Date.now()}`
    const endTime = Date.now() + 24 * 60 * 60 * 1000
    const closedAt = Date.now() - 60 * 60 * 1000
    await createPollJob(database, {
      id: 'id-closed-string-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime })
    })

    await updatePollJob(database, {
      id: 'id-closed-string-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        endTime,
        closed: getISOTimeUTC(closedAt)
      })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.endAt).toEqual(new Date(getISOTimeUTC(closedAt)).getTime())
  })

  it('accepts a boolean closed and closes the poll now', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/closed-bool-${Date.now()}`
    const endTime = Date.now() + 24 * 60 * 60 * 1000
    await createPollJob(database, {
      id: 'id-closed-bool-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime })
    })

    const before = Date.now()
    await updatePollJob(database, {
      id: 'id-closed-bool-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime, closed: true })
    })
    const after = Date.now()

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.endAt).toBeGreaterThanOrEqual(before)
    expect(status.endAt).toBeLessThanOrEqual(after)
  })

  it('applies tallies from an Update with the same updated as the last applied one', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/same-updated-${Date.now()}`
    await createPollJob(database, {
      id: 'id-same-updated-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    const updated = Date.now()
    for (const [id, red, blue] of [
      ['id-same-updated-1', 3, 4],
      ['id-same-updated-2', 8, 9]
    ] as const) {
      await updatePollJob(database, {
        id,
        name: UPDATE_POLL_JOB_NAME,
        data: MockActivityPubQuestion(pollId, {
          updated,
          oneOf: [createOption('Red', red), createOption('Blue', blue)]
        })
      })
    }

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([8, 9])
  })

  it('ignores an Update whose updated is older than the last applied one', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/stale-${Date.now()}`
    await createPollJob(database, {
      id: 'id-stale-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    const newer = Date.now()
    await updatePollJob(database, {
      id: 'id-stale-update-newer',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Second edit</p>',
        updated: newer,
        oneOf: [createOption('Red', 5), createOption('Blue', 6)]
      })
    })

    // The first edit, delivered late: older `updated`, older text and tallies
    // and a different option set, none of which may apply.
    await updatePollJob(database, {
      id: 'id-stale-update-older',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>First edit</p>',
        updated: newer - 60_000,
        oneOf: [createOption('Red', 3), createOption('Teal', 4)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.text).toEqual('<p>Second edit</p>')
    expect(status.choices.map((choice) => choice.title)).toEqual([
      'Red',
      'Blue'
    ])
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([5, 6])
    expect(status.edits).toHaveLength(1)
  })

  it('does not reset votes or change the options on an implicit Update', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/implicit-${Date.now()}`
    const originalEnd = Date.now() + 24 * 60 * 60 * 1000
    await createPollJob(database, {
      id: 'id-implicit-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        endTime: originalEnd,
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    await database.recordPollVotes({
      statusId: pollId,
      actorId: ACTOR1_ID,
      choices: [0]
    })

    // No `updated`: Mastodon's implicit path never touches the text or
    // spoiler and applies no significant change (options, mode, deadline), so
    // nothing here may change the post or reset the votes.
    await updatePollJob(database, {
      id: 'id-implicit-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        updated: null,
        content: '<p>Not an edit</p>',
        summary: 'Not a spoiler',
        endTime: originalEnd + 60 * 60 * 1000,
        anyOf: [createOption('Crimson', 9), createOption('Blue', 9)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId,
      currentActorId: ACTOR1_ID
    })) as StatusPoll
    expect(status.choices.map((choice) => choice.title)).toEqual([
      'Red',
      'Blue'
    ])
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([2, 2])
    expect(status.pollType).toEqual('oneOf')
    expect(status.endAt).toEqual(new Date(getISOTimeUTC(originalEnd)).getTime())
    expect(status.text).toEqual('<p>What is your favorite color?</p>')
    expect(status.summary).toEqual('')
    expect(status.edits).toHaveLength(0)
    expect(status.voted).toBe(true)
    expect(status.ownVotes).toEqual([0])
  })

  it('keeps each tally of options that share a title', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/dupes-${Date.now()}`
    await createPollJob(database, {
      id: 'id-dupes-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [
          createOption('Same', 1),
          createOption('Same', 2),
          createOption('Other', 3)
        ]
      })
    })

    await updatePollJob(database, {
      id: 'id-dupes-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        oneOf: [
          createUntalliedOption('Same'),
          createOption('Same', 7),
          createUntalliedOption('Other')
        ]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.choices.map((choice) => choice.totalVotes)).toEqual([1, 7, 3])
  })

  it('ignores an Update older than the updated the poll was first stored with', async () => {
    // A poll first seen (Create or fetch) already edited at T2 must not be
    // reverted by its earlier edit at T1 arriving late.
    const pollId = `${REMOTE_ACTOR_ID}/questions/first-seen-${Date.now()}`
    const firstSeen = Date.now()
    await createPollJob(database, {
      id: 'id-first-seen-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>Second edit</p>',
        updated: firstSeen,
        oneOf: [createOption('Red', 1), createOption('Blue', 2)]
      })
    })
    await database.recordPollVotes({
      statusId: pollId,
      actorId: ACTOR1_ID,
      choices: [0]
    })

    await updatePollJob(database, {
      id: 'id-first-seen-update',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, {
        content: '<p>First edit</p>',
        updated: firstSeen - 60_000,
        oneOf: [createOption('Red', 3), createOption('Teal', 4)]
      })
    })

    const status = (await database.getStatus({
      statusId: pollId,
      currentActorId: ACTOR1_ID
    })) as StatusPoll
    expect(status.text).toEqual('<p>Second edit</p>')
    expect(status.choices.map((choice) => choice.title)).toEqual([
      'Red',
      'Blue'
    ])
    expect(status.voted).toBe(true)
    expect(status.ownVotes).toEqual([0])
    expect(status.edits).toHaveLength(0)
  })

  it('keeps the deadline of a poll a boolean closed already closed', async () => {
    const pollId = `${REMOTE_ACTOR_ID}/questions/closed-twice-${Date.now()}`
    const endTime = Date.now() + 24 * 60 * 60 * 1000
    const updated = Date.now()
    await createPollJob(database, {
      id: 'id-closed-twice-create',
      name: CREATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime })
    })

    await updatePollJob(database, {
      id: 'id-closed-twice-update-1',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime, updated, closed: true })
    })
    const closedOnce = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(closedOnce.endAt).toBeLessThanOrEqual(Date.now())

    // The same Update delivered again: the poll is already closed, so it must
    // not be re-closed at a new "now" and no further revision recorded.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await updatePollJob(database, {
      id: 'id-closed-twice-update-2',
      name: UPDATE_POLL_JOB_NAME,
      data: MockActivityPubQuestion(pollId, { endTime, updated, closed: true })
    })

    const status = (await database.getStatus({
      statusId: pollId
    })) as StatusPoll
    expect(status.endAt).toEqual(closedOnce.endAt)
    expect(status.edits.length).toBeLessThanOrEqual(1)
  })
})
