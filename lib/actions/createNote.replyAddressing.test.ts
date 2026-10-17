import fetchMock from 'jest-fetch-mock'

import {
  createNoteFromUserInput,
  statusRecipientsCC
} from '@/lib/actions/createNote'
import { createPollFromUserInput } from '@/lib/actions/createPoll'
import { updateNoteVisibilityFromUserInput } from '@/lib/actions/updateNoteVisibility'
import { SEND_NOTE_JOB_NAME } from '@/lib/jobs/names'
import { sendNoteJob } from '@/lib/jobs/sendNoteJob'
import { sendUpdateNoteJob } from '@/lib/jobs/sendUpdateNoteJob'
import { getQueue } from '@/lib/services/queue'
import { Actor } from '@/lib/types/domain/actor'
import { StatusNote, StatusPoll } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { getNoteFromStatus } from '@/lib/utils/getNoteFromStatus'

import { useCreateNoteFixtures } from './createNote.testUtils'

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/timelines', () => ({
  addStatusToTimelines: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: vi.fn()
}))

describe('Reply addressing', () => {
  const { database, actors } = useCreateNoteFixtures()
  let actor1: Actor
  const communityId = 'https://lemmy.test/c/tenforward'
  const otherGroupId = 'https://mbin.test/m/mentioned'
  const remoteAuthorId = 'https://lemmy.test/u/picard'

  const createGroup = (actorId: string, username: string) =>
    database.createActor({
      actorId,
      type: 'Group',
      username,
      domain: new URL(actorId).host,
      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${new URL(actorId).host}/inbox`,
      publicKey: 'public',
      createdAt: Date.now()
    })

  beforeAll(async () => {
    actor1 = actors.actor1
    await createGroup(communityId, 'tenforward')
    await createGroup(otherGroupId, 'mentioned')
    await database.createActor({
      actorId: remoteAuthorId,
      type: 'Person',
      username: 'picard',
      domain: 'lemmy.test',
      followersUrl: `${remoteAuthorId}/followers`,
      inboxUrl: `${remoteAuthorId}/inbox`,
      sharedInboxUrl: 'https://lemmy.test/inbox',
      publicKey: 'public',
      createdAt: Date.now()
    })
  })

  const createParent = (to: string[], cc: string[]): Promise<StatusNote> =>
    database.createNote({
      id: `${remoteAuthorId}/statuses/community-${crypto.randomUUID()}`,
      url: `${remoteAuthorId}/statuses/community`,
      actorId: remoteAuthorId,
      text: 'A post in a community',
      to,
      cc
    }) as Promise<StatusNote>

  it('addresses a public reply to the parent author and the community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const reply = (await createNoteFromUserInput({
      text: 'Hello community',
      currentActor: actor1,
      replyNoteId: parent.id,
      database
    })) as StatusNote

    expect(reply.to).toEqual(
      expect.arrayContaining([ACTIVITY_STREAM_PUBLIC, actor1.followersUrl])
    )
    expect(reply.cc).toEqual(
      expect.arrayContaining([remoteAuthorId, communityId, actor1.followersUrl])
    )

    const activity = await sentCreateActivity(reply)
    expect(activity.audience).toBe(communityId)
    expect((activity.object as { audience?: string }).audience).toBe(
      communityId
    )
  })

  it('puts the community before mentions in the computed cc', () => {
    expect(
      statusRecipientsCC(
        actor1,
        [{ type: 'Mention', href: remoteAuthorId, name: '@a' }],
        null,
        'public',
        null,
        communityId
      )
    ).toEqual([actor1.followersUrl, communityId, remoteAuthorId])
  })

  it('addresses an unlisted reply to the community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const reply = (await createNoteFromUserInput({
      text: 'Quietly',
      currentActor: actor1,
      replyNoteId: parent.id,
      visibility: 'unlisted',
      database
    })) as StatusNote

    expect(reply.cc).toEqual(
      expect.arrayContaining([
        ACTIVITY_STREAM_PUBLIC,
        remoteAuthorId,
        communityId
      ])
    )
  })

  it('never addresses a followers-only reply to the community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const reply = (await createNoteFromUserInput({
      text: 'Followers only',
      currentActor: actor1,
      replyNoteId: parent.id,
      visibility: 'private',
      database
    })) as StatusNote

    expect([...reply.to, ...reply.cc]).not.toContain(communityId)
    expect([...reply.to, ...reply.cc]).toContain(remoteAuthorId)
    expect(reply.to).not.toContain(ACTIVITY_STREAM_PUBLIC)
    expect(reply.cc).not.toContain(ACTIVITY_STREAM_PUBLIC)
  })

  const sentCreateActivity = async (status: StatusNote) => {
    const publish = getQueue().publish as ReturnType<typeof vi.fn>
    publish.mockClear()
    await sendNoteJob(database, {
      id: `job-${crypto.randomUUID()}`,
      name: SEND_NOTE_JOB_NAME,
      data: { actorId: status.actorId, statusId: status.id }
    })
    const message = publish.mock.calls
      .map(([m]) => m)
      .find((m) => m.data?.activity)
    return message.data.activity as {
      audience?: string
      cc: string[]
      object: Record<string, unknown>
    }
  }

  const sentUpdateActivities = async (status: StatusNote) => {
    fetchMock.resetMocks()
    fetchMock.mockResponse('{}', { status: 202 })
    await sendUpdateNoteJob(database, {
      id: `job-${crypto.randomUUID()}`,
      name: 'SendUpdateNoteJob',
      data: { actorId: status.actorId, statusId: status.id }
    })
    return fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body ?? 'null')))
      .filter((body) => body?.type === 'Update') as {
      audience?: string
      object: { audience?: string }
    }[]
  }

  const reply = async (
    parentId: string,
    options: { text?: string; visibility?: 'public' | 'unlisted' | 'private' }
  ) =>
    (await createNoteFromUserInput({
      text: options.text ?? 'Reply',
      currentActor: actor1,
      replyNoteId: parentId,
      visibility: options.visibility,
      database
    })) as StatusNote

  it('emits the parent community as audience on Create, not a mentioned Group', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, {})
    // A mentioned Group lands in cc too; the parent's community must win
    await database.updateNoteVisibility({
      statusId: status.id,
      to: status.to,
      cc: [status.actorId, ...status.cc, otherGroupId]
    })
    const stored = (await database.getStatus({
      statusId: status.id,
      withReplies: false
    })) as StatusNote

    const activity = await sentCreateActivity(stored)
    expect(activity.audience).toBe(communityId)
    expect(activity.object.audience).toBe(communityId)
  })

  it('emits no audience for a private reply that mentions a Group', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, { visibility: 'private' })
    await database.updateNoteVisibility({
      statusId: status.id,
      to: status.to,
      cc: [...status.cc, otherGroupId]
    })
    const stored = (await database.getStatus({
      statusId: status.id,
      withReplies: false
    })) as StatusNote

    const activity = await sentCreateActivity(stored)
    expect(activity.audience).toBeUndefined()
    expect(activity.object.audience).toBeUndefined()
  })

  it('emits the audience on Update activities and their note', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, {})

    const updates = await sentUpdateActivities(status)
    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update.audience).toBe(communityId)
      expect(update.object.audience).toBe(communityId)
    }
  })

  it('emits no audience on Update for a reply outside a community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [remoteAuthorId]
    )
    const status = await reply(parent.id, {})

    const updates = await sentUpdateActivities(status)
    expect(updates.length).toBeGreaterThan(0)
    for (const update of updates) {
      expect(update.audience).toBeUndefined()
      expect(update.object.audience).toBeUndefined()
    }
  })

  it('does not name the community when the parent is not public or unlisted', async () => {
    const parent = await createParent(
      [actor1.id],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, { visibility: 'public' })

    expect([...status.to, ...status.cc]).not.toContain(communityId)
  })

  it('keeps the community when a reply goes public to unlisted', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, {})

    const updated = await updateNoteVisibilityFromUserInput({
      statusId: status.id,
      currentActor: actor1,
      visibility: 'unlisted',
      database
    })
    expect(updated?.cc).toEqual(
      expect.arrayContaining([
        ACTIVITY_STREAM_PUBLIC,
        communityId,
        remoteAuthorId
      ])
    )
  })

  it('gains the community when a private reply goes public', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const status = await reply(parent.id, { visibility: 'private' })
    expect([...status.to, ...status.cc]).not.toContain(communityId)

    const updated = await updateNoteVisibilityFromUserInput({
      statusId: status.id,
      currentActor: actor1,
      visibility: 'public',
      database
    })
    expect(updated?.cc).toContain(communityId)

    const toPrivate = await updateNoteVisibilityFromUserInput({
      statusId: status.id,
      currentActor: actor1,
      visibility: 'private',
      database
    })
    expect([...(toPrivate?.to ?? []), ...(toPrivate?.cc ?? [])]).not.toContain(
      communityId
    )
  })

  it('addresses a public poll reply to the community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [communityId, remoteAuthorId]
    )
    const poll = (await createPollFromUserInput({
      text: 'Which one?',
      currentActor: actor1,
      replyStatusId: parent.id,
      choices: ['a', 'b'],
      endAt: Date.now() + 86_400_000,
      database
    })) as StatusPoll

    expect(poll.cc).toContain(communityId)
  })

  it('does not add an audience to a reply outside a community', async () => {
    const parent = await createParent(
      [ACTIVITY_STREAM_PUBLIC],
      [remoteAuthorId]
    )
    const reply = (await createNoteFromUserInput({
      text: 'Plain reply',
      currentActor: actor1,
      replyNoteId: parent.id,
      database
    })) as StatusNote

    expect(reply.cc).toContain(remoteAuthorId)
    expect(reply.cc).not.toContain(communityId)
    expect(getNoteFromStatus(reply)?.audience).toBeUndefined()
    expect((await sentCreateActivity(reply)).audience).toBeUndefined()
  })
})
