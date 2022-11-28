import { fromJson } from '../../lib/models/status'
import { MockCreateActivity } from '../../lib/stub/createActivity'
import { handleCreate } from './inbox'

const mockStorage = {
  createStatus: jest.fn()
} as any

describe('#handleCreate', () => {
  it.only('add status into storage', async () => {
    const activity = MockCreateActivity({ content: '<p>Hello</p>' })
    await handleCreate({ storage: mockStorage, object: activity.object })
    expect(mockStorage.createStatus).toHaveBeenCalledWith({
      status: fromJson(activity.object)
    })
  })
})
