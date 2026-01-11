import { z } from 'zod'

import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'

export const Scope = z.enum(['read', 'write', 'follow', 'push'])
export type Scope = z.infer<typeof Scope>

export const UsableScopes = [
  Scope.enum.read,
  Scope.enum.write,
  Scope.enum.follow
]

export const GrantIdentifiers = z.enum([
  'authorization_code',
  'client_credentials',
  'refresh_token',
  'password',
  'implicit'
])
export type GrantIdentifiers = z.infer<typeof GrantIdentifiers>

export const CreateClientParams = z.object({
  name: z.string(),
  redirectUris: z.string().array(),
  secret: z.string(),
  scopes: Scope.array(),
  website: z.string().optional()
})
export type CreateClientParams = z.infer<typeof CreateClientParams>

export const GetClientFromNameParams = z.object({
  name: z.string()
})
export type GetClientFromNameParams = z.infer<typeof GetClientFromNameParams>

export const GetClientFromIdParams = z.object({
  clientId: z.string()
})
export type GetClientFromIdParams = z.infer<typeof GetClientFromIdParams>

export const UpdateClientParams = CreateClientParams.extend({
  id: z.string()
})
export type UpdateClientParams = z.infer<typeof UpdateClientParams>

export const GetAccessTokenParams = z.object({
  accessToken: z.string()
})
export type GetAccessTokenParams = z.infer<typeof GetAccessTokenParams>

export const GetAccessTokenByRefreshTokenParams = z.object({
  refreshToken: z.string()
})
export type GetAccessTokenByRefreshTokenParams = z.infer<
  typeof GetAccessTokenByRefreshTokenParams
>

export const CreateAccessTokenParams = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),

  refreshToken: z.string().nullish(),
  refreshTokenExpiresAt: z.number().nullish(),

  clientId: z.string(),
  scopes: Scope.array(),

  actorId: z.string().nullish(),
  accountId: z.string().nullish()
})
export type CreateAccessTokenParams = z.infer<typeof CreateAccessTokenParams>

export const UpdateRefreshTokenParams = z.object({
  accessToken: z.string(),

  refreshToken: z.string(),
  refreshTokenExpiresAt: z.number().nullish()
})
export type UpdateRefreshTokenParams = z.infer<typeof UpdateRefreshTokenParams>

export const RevokeAccessTokenParams = z.object({ accessToken: z.string() })
export type RevokeAccessTokenParams = z.infer<typeof RevokeAccessTokenParams>

export const TouchAccessTokenParams = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),
  refreshTokenExpiresAt: z.number().nullish()
})
export type TouchAccessTokenParams = z.infer<typeof TouchAccessTokenParams>

export const CreateAuthCodeParams = z.object({
  code: z.string(),
  redirectUri: z.string().nullish(),
  codeChallenge: z.string().nullish(),
  codeChallengeMethod: z.string().nullish(),

  actorId: z.string(),
  accountId: z.string(),
  clientId: z.string(),
  scopes: Scope.array(),

  expiresAt: z.number()
})
export type CreateAuthCodeParams = z.infer<typeof CreateAuthCodeParams>

export const GetAuthCodeParams = z.object({ code: z.string() })
export type GetAuthCodeParams = z.infer<typeof GetAuthCodeParams>

export const RevokeAuthCodeParams = z.object({ code: z.string() })
export type RevokeAuthCodeParams = z.infer<typeof RevokeAuthCodeParams>

export interface OAuthDatabase {
  createClient(params: CreateClientParams): Promise<Client | null>
  getClientFromName(params: GetClientFromNameParams): Promise<Client | null>
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
  updateClient(params: UpdateClientParams): Promise<Client | null>

  getAccessToken(params: GetAccessTokenParams): Promise<Token | null>
  getAccessTokenByRefreshToken(
    params: GetAccessTokenByRefreshTokenParams
  ): Promise<Token | null>
  createAccessToken(params: CreateAccessTokenParams): Promise<Token | null>
  updateRefreshToken(params: UpdateRefreshTokenParams): Promise<Token | null>
  revokeAccessToken(params: RevokeAccessTokenParams): Promise<Token | null>
  touchAccessToken(params: TouchAccessTokenParams): Promise<void>

  createAuthCode(params: CreateAuthCodeParams): Promise<AuthCode | null>
  getAuthCode(params: GetAuthCodeParams): Promise<AuthCode | null>
  revokeAuthCode(params: RevokeAuthCodeParams): Promise<AuthCode | null>
}
