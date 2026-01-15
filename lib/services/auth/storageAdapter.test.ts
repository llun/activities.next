import { getTestSQLDatabase } from '../../database/testUtils'
import { seedDatabase } from '../../stub/database'
import { seedActor1 } from '../../stub/seed/actor1'
import { StorageAdapter, userFromAccount } from './storageAdapter'

// Mock database getter
let mockDatabase: ReturnType<typeof getTestSQLDatabase> | null = null
jest.mock('../../database', () => ({
  getDatabase: () => mockDatabase
}))

describe('StorageAdapter', () => {
  const database = getTestSQLDatabase()
  let adapter: ReturnType<typeof StorageAdapter>

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    mockDatabase = database
    adapter = StorageAdapter('test-secret')
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('userFromAccount', () => {
    it('converts account to adapter user format', () => {
      const account = {
        id: 'test-id',
        email: 'test@example.com',
        createdAt: Date.now()
      }

      const user = userFromAccount(account as never)

      expect(user.id).toBe('test-id')
      expect(user.email).toBe('test@example.com')
      expect(user.emailVerified).toBeInstanceOf(Date)
    })
  })

  describe('getUserByEmail', () => {
    it('returns user when email exists', async () => {
      const user = await adapter.getUserByEmail!(seedActor1.email)

      expect(user).not.toBeNull()
      expect(user?.email).toBe(seedActor1.email)
    })

    it('returns null for non-existent email', async () => {
      const user = await adapter.getUserByEmail!('nonexistent@example.com')

      expect(user).toBeNull()
    })
  })

  describe('getUser', () => {
    it('returns user when id exists', async () => {
      // First get a user to get their ID
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })
      const user = await adapter.getUser!(actor!.account!.id)

      expect(user).not.toBeNull()
      expect(user?.email).toBe(seedActor1.email)
    })

    it('returns null for non-existent id', async () => {
      const user = await adapter.getUser!('nonexistent-id')

      expect(user).toBeNull()
    })
  })

  describe('createSession', () => {
    it('creates a session', async () => {
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })

      const session = await adapter.createSession!({
        sessionToken: 'test-session-token-123',
        userId: actor!.account!.id,
        expires: new Date(Date.now() + 86400000)
      })

      expect(session.sessionToken).toBe('test-session-token-123')
      expect(session.userId).toBe(actor!.account!.id)
    })
  })

  describe('getSessionAndUser', () => {
    it('returns session and user for valid token', async () => {
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })

      // Create a session first
      const token = 'test-get-session-token-456'
      await adapter.createSession!({
        sessionToken: token,
        userId: actor!.account!.id,
        expires: new Date(Date.now() + 86400000)
      })

      const result = await adapter.getSessionAndUser!(token)

      expect(result).not.toBeNull()
      expect(result?.session.sessionToken).toBe(token)
      expect(result?.user.email).toBe(seedActor1.email)
    })

    it('returns null for non-existent token', async () => {
      const result = await adapter.getSessionAndUser!('nonexistent-token')

      expect(result).toBeNull()
    })
  })

  describe('deleteSession', () => {
    it('deletes a session', async () => {
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })

      // Create a session
      const token = 'test-delete-session-token-789'
      await adapter.createSession!({
        sessionToken: token,
        userId: actor!.account!.id,
        expires: new Date(Date.now() + 86400000)
      })

      // Delete the session
      await adapter.deleteSession!(token)

      // Verify it's deleted
      const result = await adapter.getSessionAndUser!(token)
      expect(result).toBeNull()
    })
  })

  describe('updateSession', () => {
    it('updates session expiry', async () => {
      const actor = await database.getActorFromEmail({
        email: seedActor1.email
      })

      // Create a session
      const token = 'test-update-session-token-abc'
      const originalExpires = new Date(Date.now() + 86400000)
      await adapter.createSession!({
        sessionToken: token,
        userId: actor!.account!.id,
        expires: originalExpires
      })

      // Update the session
      const newExpires = new Date(Date.now() + 172800000)
      const updated = await adapter.updateSession!({
        sessionToken: token,
        expires: newExpires
      })

      expect(updated).not.toBeNull()
      expect(updated?.expires.getTime()).toBeGreaterThan(
        originalExpires.getTime()
      )
    })

    it('returns null when database unavailable', async () => {
      const originalDb = mockDatabase
      mockDatabase = null

      const result = await adapter.updateSession!({
        sessionToken: 'any-token',
        expires: new Date()
      })

      expect(result).toBeNull()
      mockDatabase = originalDb
    })
  })
})
