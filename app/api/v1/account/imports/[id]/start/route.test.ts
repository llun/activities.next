import { NextRequest } from 'next/server'

import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { HTTP_STATUS } from '@/lib/utils/response'

import { POST } from './route'

vi.mock('@/lib/services/guards/AuthenticatedGuard', () => ({
  AuthenticatedGuard: (handler: unknown) => handler
}))

vi.mock('@/lib/services/accounts/movedAccount', () => ({
  isMovedActor: () => false
}))

describe('start account import actor state', () => {
  const currentActor = {
    id: 'https://llun.test/users/current',
    account: { id: 'account-id' }
  } as Actor
  const database = {
    getActorFromId: vi.fn().mockResolvedValue(currentActor),
    getAccountImport: vi.fn().mockResolvedValue(null)
  } as unknown as Database

  const request = () =>
    new NextRequest(
      'https://llun.test/api/v1/account/imports/import-id/start',
      {
        method: 'POST',
        headers: {
          origin: 'https://llun.test',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ options: {} }),
        duplex: 'half'
      } as ConstructorParameters<typeof NextRequest>[1]
    )

  const start = () =>
    POST(request(), {
      params: Promise.resolve({ id: 'import-id' }),
      currentActor,
      database
    } as never)

  beforeEach(() => {
    vi.mocked(database.getActorFromId)
      .mockReset()
      .mockResolvedValue(currentActor)
    vi.mocked(database.getAccountImport).mockClear()
  })

  it('refuses a suspended actor with 403 before inspecting the import', async () => {
    vi.mocked(database.getActorFromId).mockResolvedValue({
      ...currentActor,
      suspendedAt: Date.now()
    })

    const response = await start()

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN)
    expect(database.getActorFromId).toHaveBeenCalledWith({
      id: currentActor.id
    })
    expect(database.getAccountImport).not.toHaveBeenCalled()
  })

  it.each(['scheduled', 'deleting'] as const)(
    'refuses an actor with deletion state %s with 422',
    async (deletionStatus) => {
      vi.mocked(database.getActorFromId).mockResolvedValue({
        ...currentActor,
        deletionStatus
      })

      const response = await start()

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      expect(database.getActorFromId).toHaveBeenCalledWith({
        id: currentActor.id
      })
      expect(database.getAccountImport).not.toHaveBeenCalled()
    }
  )
})
