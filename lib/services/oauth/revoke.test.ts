import jwt from 'jsonwebtoken'

import { revokeToken } from './revoke'

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn()
}))

// Mock config
jest.mock('../../config', () => ({
  getConfig: jest.fn().mockReturnValue({ secretPhase: 'test-secret' })
}))

describe('#revokeToken', () => {
  const mockDatabase = {
    getAccessToken: jest.fn(),
    getAccessTokenByRefreshToken: jest.fn(),
    revokeAccessToken: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('revokes valid access token', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValue({ jti: 'access-token-123' })
    mockDatabase.getAccessToken.mockResolvedValue({
      accessToken: 'access-token-123'
    })
    mockDatabase.revokeAccessToken.mockResolvedValue(undefined)

    const result = await revokeToken({
      database: mockDatabase as any,
      token: 'valid-jwt-token'
    })

    expect(result).toBe(true)
    expect(mockDatabase.revokeAccessToken).toHaveBeenCalledWith({
      accessToken: 'access-token-123'
    })
  })

  it('revokes refresh token when token_type_hint is refresh_token', async () => {
    ;(jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid token')
    })
    mockDatabase.getAccessTokenByRefreshToken.mockResolvedValue({
      accessToken: 'access-token-456'
    })
    mockDatabase.revokeAccessToken.mockResolvedValue(undefined)

    const result = await revokeToken({
      database: mockDatabase as any,
      token: 'refresh-token-value',
      tokenTypeHint: 'refresh_token'
    })

    expect(result).toBe(true)
    expect(mockDatabase.getAccessTokenByRefreshToken).toHaveBeenCalledWith({
      refreshToken: 'refresh-token-value'
    })
  })

  it('returns false when token not found', async () => {
    ;(jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid token')
    })
    mockDatabase.getAccessTokenByRefreshToken.mockResolvedValue(null)

    const result = await revokeToken({
      database: mockDatabase as any,
      token: 'unknown-token'
    })

    expect(result).toBe(false)
  })

  it('tries refresh token when JWT verification fails', async () => {
    ;(jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('jwt malformed')
    })
    mockDatabase.getAccessTokenByRefreshToken.mockResolvedValue({
      accessToken: 'found-via-refresh'
    })
    mockDatabase.revokeAccessToken.mockResolvedValue(undefined)

    const result = await revokeToken({
      database: mockDatabase as any,
      token: 'some-refresh-token'
    })

    expect(result).toBe(true)
  })

  it('handles access token not found after JWT decode', async () => {
    ;(jwt.verify as jest.Mock).mockReturnValue({ jti: 'nonexistent-token' })
    mockDatabase.getAccessToken.mockResolvedValue(null)
    mockDatabase.getAccessTokenByRefreshToken.mockResolvedValue(null)

    const result = await revokeToken({
      database: mockDatabase as any,
      token: 'valid-jwt-but-deleted'
    })

    expect(result).toBe(false)
  })
})
