import { Database } from '@/lib/database/types'
import {
  GetModerationStatesForActorsParams,
  ModerationStates
} from '@/lib/types/database/operations'
import { Status, StatusType } from '@/lib/types/domain/status'

import { filterModeratedStatuses } from './moderationFilter'

const cleanActorId = 'https://llun.test/users/clean'
const suspendedActorId = 'https://remote.test/users/suspended'
const silencedActorId = 'https://remote.test/users/silenced'

const createNoteStatus = (name: string, actorId: string) =>
  ({
    id: `https://llun.test/statuses/${name}`,
    actorId,
    type: StatusType.enum.Note
  }) as Status

const createAnnounceStatus = (
  name: string,
  announcerActorId: string,
  originalActorId: string
) =>
  ({
    id: `https://llun.test/statuses/${name}`,
    actorId: announcerActorId,
    type: StatusType.enum.Announce,
    originalStatus: {
      id: `${originalActorId}/statuses/original-${name}`,
      actorId: originalActorId,
      type: StatusType.enum.Note
    }
  }) as unknown as Status

const stateOf = (overrides: Partial<ModerationStates>): ModerationStates => ({
  suspendedAt: null,
  silencedAt: null,
  sensitizedAt: null,
  ...overrides
})

const databaseWithStates = (
  statesByActor: Record<string, ModerationStates>
): Database =>
  ({
    getModerationStatesForActors: vi.fn(
      async ({ actorIds }: GetModerationStatesForActorsParams) => {
        const map = new Map<string, ModerationStates>()
        for (const id of actorIds) {
          if (statesByActor[id]) map.set(id, statesByActor[id])
        }
        return map
      }
    )
  }) as unknown as Database

describe('filterModeratedStatuses', () => {
  it.each([{ includeSilenced: true }, { includeSilenced: false }])(
    'drops statuses and announces authored by suspended actors on every surface (includeSilenced=$includeSilenced)',
    async ({ includeSilenced }) => {
      const database = databaseWithStates({
        [suspendedActorId]: stateOf({ suspendedAt: 1 })
      })
      const statuses = [
        createNoteStatus('note-suspended', suspendedActorId),
        createAnnounceStatus(
          'announce-suspended',
          cleanActorId,
          suspendedActorId
        ),
        createNoteStatus('note-clean', cleanActorId)
      ]

      const result = await filterModeratedStatuses(
        database,
        statuses,
        includeSilenced
      )

      expect(result.map((status) => status.id)).toEqual([
        'https://llun.test/statuses/note-clean'
      ])
    }
  )

  it('drops silenced authors only when includeSilenced is false', async () => {
    const database = databaseWithStates({
      [silencedActorId]: stateOf({ silencedAt: 1 })
    })
    const statuses = [createNoteStatus('note-silenced', silencedActorId)]

    const publicResult = await filterModeratedStatuses(
      database,
      statuses,
      false
    )
    expect(publicResult).toHaveLength(0)

    const followingResult = await filterModeratedStatuses(
      database,
      statuses,
      true
    )
    expect(followingResult.map((status) => status.id)).toEqual([
      'https://llun.test/statuses/note-silenced'
    ])
  })

  it('checks the announced original author as well as the announcing actor', async () => {
    const database = databaseWithStates({
      [suspendedActorId]: stateOf({ suspendedAt: 1 })
    })
    const statuses = [
      // Announcer is clean but the original author is suspended.
      createAnnounceStatus(
        'announce-of-suspended',
        cleanActorId,
        suspendedActorId
      ),
      createAnnounceStatus('announce-clean', cleanActorId, cleanActorId)
    ]

    const result = await filterModeratedStatuses(database, statuses, false)

    expect(result.map((status) => status.id)).toEqual([
      'https://llun.test/statuses/announce-clean'
    ])
  })

  it('returns an empty batch unchanged without querying states', async () => {
    const database = databaseWithStates({})
    const result = await filterModeratedStatuses(database, [], false)
    expect(result).toEqual([])
    expect(database.getModerationStatesForActors).not.toHaveBeenCalled()
  })
})
