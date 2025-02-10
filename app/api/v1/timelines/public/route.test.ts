describe('Public Timelines Route', () => {
  beforeAll(() => {})
  afterAll(() => {})

  it('should return public timelines', async () => {
    const response = await request(app).get('/api/v1/timelines/public')
    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('timelines')
    expect(Array.isArray(response.body.timelines)).toBe(true)
    expect(response.body.timelines.length).toBeGreaterThan(0)
  })
})
