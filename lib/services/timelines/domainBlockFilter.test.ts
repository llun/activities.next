import { Status, StatusType } from '@/lib/types/domain/status'

import {
  filterDomainBlockedStatuses,
  getRelevantStatusDomains
} from './domainBlockFilter'

const note = (id: string, actorId: string) =>
  ({ id, actorId, type: StatusType.enum.Note }) as Status

const announce = (id: string, actorId: string, originalActorId: string) =>
  ({
    id,
    actorId,
    type: StatusType.enum.Announce,
    originalStatus: { actorId: originalActorId }
  }) as unknown as Status

describe('getRelevantStatusDomains', () => {
  it('returns the author domain for a note', () => {
    expect(
      getRelevantStatusDomains(
        note(
          'https://llun.test/users/a/statuses/1',
          'https://llun.test/users/a'
        )
      )
    ).toEqual(['llun.test'])
  })

  it('includes the boosted author domain for an announce', () => {
    expect(
      getRelevantStatusDomains(
        announce(
          'https://llun.test/users/a/statuses/2',
          'https://llun.test/users/a',
          'https://blocked.test/users/b'
        )
      ).sort()
    ).toEqual(['blocked.test', 'llun.test'])
  })

  it('skips actor ids that are not valid urls', () => {
    expect(getRelevantStatusDomains(note('urn:1', 'not-a-url'))).toEqual([])
  })
})

describe('filterDomainBlockedStatuses', () => {
  const blocked = new Set(['blocked.test'])

  it('drops notes authored on a blocked domain', () => {
    const kept = note(
      'https://llun.test/users/a/statuses/1',
      'https://llun.test/users/a'
    )
    const dropped = note(
      'https://blocked.test/users/b/statuses/1',
      'https://blocked.test/users/b'
    )

    expect(filterDomainBlockedStatuses(blocked, [kept, dropped])).toEqual([
      kept
    ])
  })

  it('drops boosts of statuses authored on a blocked domain', () => {
    const boost = announce(
      'https://llun.test/users/a/statuses/2',
      'https://llun.test/users/a',
      'https://blocked.test/users/b'
    )

    expect(filterDomainBlockedStatuses(blocked, [boost])).toEqual([])
  })

  it('returns statuses unchanged when no domains are blocked', () => {
    const statuses = [
      note(
        'https://blocked.test/users/b/statuses/1',
        'https://blocked.test/users/b'
      )
    ]

    expect(filterDomainBlockedStatuses(new Set(), statuses)).toEqual(statuses)
  })
})
