import { OAuthScope } from '@jmondi/oauth2-server'

import { getTestSQLDatabase } from '../../database/testUtils'
import { Scope } from '../../database/types/oauth'
import { seedDatabase } from '../../stub/database'
import { TokenRepository } from './tokenRepository'

describe('TokenRepository', () => {
  const database = getTestSQLDatabase()
  let tokenRepository: TokenRepository
  let testScopes: OAuthScope[]

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    tokenRepository = new TokenRepository(database)

    // Create a test OAuth client
    await database.createClient({
      name: 'Test Client',
      secret: 'test-client-secret',
      scopes: [Scope.enum.read, Scope.enum.write],
      redirectUris: ['https://example.com/callback']
    })

    testScopes = [{ name: 'read' }, { name: 'write' }]
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('issueToken', () => {
    it('creates and returns a new access token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)

      expect(token.accessToken).toBeDefined()
      expect(token.accessToken.length).toBeGreaterThan(0)
      expect(token.client.id).toBe(client!.id)
      expect(token.scopes).toHaveLength(2)
    })

    it('creates token without user for client credentials', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)

      expect(token.accessToken).toBeDefined()
      expect(token.user).toBeUndefined()
    })
  })

  describe('findById', () => {
    it('finds an existing token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const issuedToken = await tokenRepository.issueToken(client!, testScopes)

      const foundToken = await tokenRepository.findById(issuedToken.accessToken)

      expect(foundToken.accessToken).toBe(issuedToken.accessToken)
    })

    it('throws error when token not found', async () => {
      await expect(
        tokenRepository.findById('nonexistent-token')
      ).rejects.toThrow('Fail to find token')
    })
  })

  describe('issueRefreshToken', () => {
    it('updates token with refresh token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)

      const tokenWithRefresh = await tokenRepository.issueRefreshToken(token)

      expect(tokenWithRefresh.refreshToken).toBeDefined()
      expect(tokenWithRefresh.refreshTokenExpiresAt).toBeDefined()
    })
  })

  describe('getByRefreshToken', () => {
    it('finds token by refresh token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)
      const tokenWithRefresh = await tokenRepository.issueRefreshToken(token)

      const foundToken = await tokenRepository.getByRefreshToken(
        tokenWithRefresh.refreshToken!
      )

      expect(foundToken.accessToken).toBe(token.accessToken)
    })

    it('throws error when refresh token not found', async () => {
      await expect(
        tokenRepository.getByRefreshToken('nonexistent-refresh-token')
      ).rejects.toThrow()
    })
  })

  describe('isRefreshTokenRevoked', () => {
    it('returns false for valid refresh token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)
      const tokenWithRefresh = await tokenRepository.issueRefreshToken(token)

      const isRevoked =
        await tokenRepository.isRefreshTokenRevoked(tokenWithRefresh)

      expect(isRevoked).toBe(false)
    })

    it('returns true for expired refresh token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const expiredToken = {
        accessToken: 'test',
        accessTokenExpiresAt: new Date(),
        refreshToken: 'test-refresh',
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
        client: client!,
        scopes: testScopes
      }

      const isRevoked =
        await tokenRepository.isRefreshTokenRevoked(expiredToken)

      expect(isRevoked).toBe(true)
    })

    it('returns true when refresh token has no expiry', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const tokenWithNoExpiry = {
        accessToken: 'test',
        accessTokenExpiresAt: new Date(),
        refreshToken: null,
        refreshTokenExpiresAt: null,
        client: client!,
        scopes: testScopes
      }

      const isRevoked =
        await tokenRepository.isRefreshTokenRevoked(tokenWithNoExpiry)

      expect(isRevoked).toBe(true)
    })
  })

  describe('persist', () => {
    it('does nothing if token already exists', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)

      // Should not throw
      await tokenRepository.persist(token)
    })
  })

  describe('revoke', () => {
    it('revokes an access token', async () => {
      const client = await database.getClientFromName({ name: 'Test Client' })
      const token = await tokenRepository.issueToken(client!, testScopes)

      await tokenRepository.revoke(token)

      // Token should be revoked (expire time set to now or past)
      const revokedToken = await tokenRepository.findById(token.accessToken)
      expect(revokedToken.accessTokenExpiresAt.getTime()).toBeLessThanOrEqual(
        Date.now()
      )
    })
  })
})
