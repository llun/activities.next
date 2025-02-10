import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'

import { GET } from './route'

const database = getTestSQLDatabase()
jest.mock('../../../../../lib/database', () => ({
  getDatabase: () => database
}))

describe('Public Timelines Route', () => {
  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
  })
  afterAll(async () => {
    if (!database) return
    await database.destroy()
  })

  it('should return public timelines', async () => {
    const response = await GET()
    console.log(response.status)
  })
})
