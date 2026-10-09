import { waitFor } from './waitFor'

describe('waitFor', () => {
  it('resolves with void after the specified time', async () => {
    const startTime = Date.now()
    const result = await waitFor(50)
    const endTime = Date.now()
    expect(result).toBeUndefined()
    expect(endTime - startTime).toBeGreaterThanOrEqual(45)
  })
})
