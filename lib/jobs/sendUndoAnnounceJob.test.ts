import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { sendUndoAnnounceJob } from '@/lib/jobs/sendUndoAnnounceJob'
import { Actor } from '@/lib/models/actor'
import { Status, StatusType } from '@/lib/models/status'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'

import { undoAnnounce } from '../activities'

// Mock the activities module
jest.mock('../activities', () => ({
  undoAnnounce: jest.fn().mockResolvedValue(undefined)
}))

describe('sendUndoAnnounceJob', () => {
  const database = getTestSQLDatabase()
  let actor1: Actor

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)

    actor1 = (await database.getActorFromEmail({
      email: seedActor1.email
    })) as Actor
  })

  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends undo announce to all follower inboxes', async () => {
    const announceStatus = {
      id: `${actor1.id}/statuses/announce-1`,
      type: StatusType.enum.Announce
    } as Status

    const inboxes = ['https://example.com/inbox1', 'https://example.com/inbox2']

    const mockDatabase = {
      ...database,
      getStatus: jest.fn().mockResolvedValue(announceStatus),
      getActorFromId: jest.fn().mockResolvedValue(actor1),
      getFollowersInbox: jest.fn().mockResolvedValue(inboxes)
    }

    await sendUndoAnnounceJob(mockDatabase, {
      id: 'test-job',
      name: 'SendUndoAnnounceJob',
      data: {
        actorId: actor1.id,
        statusId: announceStatus.id
      }
    })

    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: announceStatus.id,
      withReplies: false
    })
    expect(mockDatabase.getActorFromId).toHaveBeenCalledWith({
      id: actor1.id
    })
    expect(mockDatabase.getFollowersInbox).toHaveBeenCalledWith({
      targetActorId: actor1.id
    })

    expect(undoAnnounce).toHaveBeenCalledTimes(2)
    inboxes.forEach((inbox) => {
      expect(undoAnnounce).toHaveBeenCalledWith({
        currentActor: actor1,
        inbox,
        announce: announceStatus
      })
    })
  })

  it('does nothing when status is not found', async () => {
    const mockDatabase = {
      ...database,
      getStatus: jest.fn().mockResolvedValue(null),
      getActorFromId: jest.fn().mockResolvedValue(actor1)
    }

    await sendUndoAnnounceJob(mockDatabase, {
      id: 'test-job',
      name: 'SendUndoAnnounceJob',
      data: {
        actorId: actor1.id,
        statusId: 'nonexistent-status'
      }
    })

    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: 'nonexistent-status',
      withReplies: false
    })
    expect(undoAnnounce).not.toHaveBeenCalled()
  })

  it('does nothing when actor is not found', async () => {
    const announceStatus = {
      id: `${actor1.id}/statuses/announce-1`,
      type: StatusType.enum.Announce
    } as Status

    const mockDatabase = {
      ...database,
      getStatus: jest.fn().mockResolvedValue(announceStatus),
      getActorFromId: jest.fn().mockResolvedValue(null)
    }

    await sendUndoAnnounceJob(mockDatabase, {
      id: 'test-job',
      name: 'SendUndoAnnounceJob',
      data: {
        actorId: 'nonexistent-actor',
        statusId: announceStatus.id
      }
    })

    expect(mockDatabase.getActorFromId).toHaveBeenCalledWith({
      id: 'nonexistent-actor'
    })
    expect(undoAnnounce).not.toHaveBeenCalled()
  })

  it('does nothing when status is not an announce', async () => {
    const noteStatus = {
      id: `${actor1.id}/statuses/note-1`,
      type: StatusType.enum.Note
    } as Status

    const mockDatabase = {
      ...database,
      getStatus: jest.fn().mockResolvedValue(noteStatus),
      getActorFromId: jest.fn().mockResolvedValue(actor1)
    }

    await sendUndoAnnounceJob(mockDatabase, {
      id: 'test-job',
      name: 'SendUndoAnnounceJob',
      data: {
        actorId: actor1.id,
        statusId: noteStatus.id
      }
    })

    expect(mockDatabase.getStatus).toHaveBeenCalledWith({
      statusId: noteStatus.id,
      withReplies: false
    })
    expect(undoAnnounce).not.toHaveBeenCalled()
  })
})
