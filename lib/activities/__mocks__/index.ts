import { GetPublicProfileParams } from '..'
import { MockPerson } from '../../stub/person'

export const acceptFollow = jest.fn()
export const getPublicProfile = jest.fn(({ actorId }: GetPublicProfileParams) =>
  MockPerson({ id: actorId })
)
