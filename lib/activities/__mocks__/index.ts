import { testUserId } from '../../stub/const'
import { MockPerson } from '../../stub/person'

export const acceptFollow = jest.fn()
export const getPublicProfile = jest
  .fn()
  .mockResolvedValue(MockPerson({ id: testUserId('null') }))
