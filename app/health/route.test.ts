import { GET } from './route'

describe('GET /health', () => {
  it('returns status UP without authentication', async () => {
    const response = GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'UP' })
  })
})
