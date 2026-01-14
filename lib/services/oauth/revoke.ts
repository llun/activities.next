import jwt from 'jsonwebtoken'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

interface RevokeTokenParams {
  database: Database
  token: string
  tokenTypeHint?: string | null
}

export const revokeToken = async ({
  database,
  token,
  tokenTypeHint
}: RevokeTokenParams): Promise<boolean> => {
  // Try to decode the token to get the jti (access token identifier)
  try {
    const decoded = jwt.verify(token, getConfig().secretPhase) as jwt.JwtPayload
    const accessTokenId = decoded.jti

    if (accessTokenId) {
      const accessToken = await database.getAccessToken({
        accessToken: accessTokenId
      })
      if (accessToken) {
        await database.revokeAccessToken({ accessToken: accessTokenId })
        return true
      }
    }
  } catch {
    // Token might be invalid or expired, try as refresh token
  }

  // If tokenTypeHint is 'refresh_token' or JWT decode failed, try refresh token
  if (tokenTypeHint === 'refresh_token' || tokenTypeHint !== 'access_token') {
    try {
      // Refresh tokens may also be JWTs, decode to get the refresh token ID
      let refreshTokenId = token
      try {
        const decoded = jwt.verify(
          token,
          getConfig().secretPhase
        ) as jwt.JwtPayload
        // Use jti or refresh_token_id from JWT payload
        refreshTokenId = decoded.jti || decoded.refresh_token_id || token
      } catch {
        // If not a JWT or invalid, use token as-is (opaque token)
      }

      const accessToken = await database.getAccessTokenByRefreshToken({
        refreshToken: refreshTokenId
      })
      if (accessToken) {
        await database.revokeAccessToken({
          accessToken: accessToken.accessToken
        })
        return true
      }
    } catch {
      // Refresh token not found
    }
  }

  // Per RFC 7009, returning success even if token not found is acceptable
  return false
}
