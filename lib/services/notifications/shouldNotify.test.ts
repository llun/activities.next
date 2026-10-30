import { Database } from '@/lib/database/types'

import { shouldCreateNotification } from './shouldNotify'

const recipientActorId = 'https://llun.test/users/recipient'
const sourceActorId = 'https://llun.test/users/source'

interface MockDatabaseOverrides {
  isEitherBlocking?: jest.Mock
  getMute?: jest.Mock
}

const makeDatabase = ({
  isEitherBlocking = vi.fn(async () => false),
  getMute = vi.fn(async () => null)
}: MockDatabaseOverrides = {}) =>
  ({
    isEitherBlocking,
    getMute
  }) as unknown as Database

describe('shouldCreateNotification', () => {
  it('returns false when recipient and source are the same actor', async () => {
    const isEitherBlocking = vi.fn(async () => false)
    const getMute = vi.fn(async () => null)
    const database = makeDatabase({ isEitherBlocking, getMute })

    const result = await shouldCreateNotification(
      database,
      recipientActorId,
      recipientActorId
    )

    expect(result).toBe(false)
    expect(isEitherBlocking).not.toHaveBeenCalled()
    expect(getMute).not.toHaveBeenCalled()
  })

  it('returns true when there is no block and no mute', async () => {
    const database = makeDatabase()

    const result = await shouldCreateNotification(
      database,
      recipientActorId,
      sourceActorId
    )

    expect(result).toBe(true)
  })
})
