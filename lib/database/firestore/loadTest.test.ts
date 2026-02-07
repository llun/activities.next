import { getTestDatabaseTable } from '@/lib/database/testUtils'

describe('Firestore Load Test', () => {
  const table = getTestDatabaseTable().filter(([name]) => name === 'firestore')
  if (table.length === 0) {
    it.skip('Skip Firestore load test', () => {})
    return
  }

  const [, database] = table[0]

  it('should handle many statuses and queries fast', async () => {
    const actorId = 'https://example.com/users/test'
    await database.createActor({
      actorId,
      username: 'test',
      domain: 'example.com',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://example.com/inbox',
      followersUrl: `${actorId}/followers`,
      publicKey: 'public-key',
      createdAt: Date.now()
    })

    const count = 100
    const start = Date.now()
    for (let i = 0; i < count; i++) {
      await database.createNote({
        id: `status-${i}`,
        url: `https://example.com/statuses/status-${i}`,
        actorId,
        text: `Status ${i}`,
        to: [],
        cc: []
      })
    }
    const end = Date.now()
    console.log(`Created ${count} statuses in ${end - start}ms`)
    expect(end - start).toBeLessThan(10000) // Adjust as needed for CI/local

    const queryStart = Date.now()
    const statuses = await database.getActorStatuses({ actorId, limit: 20 })
    const queryEnd = Date.now()
    console.log(`Queried 20 statuses in ${queryEnd - queryStart}ms`)
    expect(statuses.length).toBe(20)
    expect(queryEnd - queryStart).toBeLessThan(200) // Firestore should be fast
  })
})
