import { getTestSQLDatabase } from '../../database/testUtils'
import { seedDatabase } from '../../stub/database'
import { ACTOR1_ID } from '../../stub/seed/actor1'
import { UserRepository } from './userRepository'

describe('UserRepository', () => {
  const database = getTestSQLDatabase()
  let userRepository: UserRepository

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    userRepository = new UserRepository(database)
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('getUserByCredentials', () => {
    it('returns user for valid actor id', async () => {
      const user = await userRepository.getUserByCredentials(ACTOR1_ID)

      expect(user).toBeDefined()
      expect(user.actor).toBeDefined()
      expect(user.account).toBeDefined()
    })

    it('throws error when actor not found', async () => {
      await expect(
        userRepository.getUserByCredentials('https://nonexistent.test/users/x')
      ).rejects.toThrow('Fail to find actor')
    })
  })
})
