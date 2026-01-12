import { waitFor } from './waitFor'

describe('#waitFor', () => {
  it('resolves after the specified time', async () => {
    const startTime = Date.now()
    await waitFor(50)
    const endTime = Date.now()
    expect(endTime - startTime).toBeGreaterThanOrEqual(45)
  })

  it('resolves with void', async () => {
    const result = await waitFor(10)
    expect(result).toBeUndefined()
  })
})
