import { z } from 'zod'

import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'

export const Scopes = z.enum(['read', 'write', 'follow', 'push'])
export type Scopes = z.infer<typeof Scopes>

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
  scopes: Scopes.array(),
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
  scopes: Scopes.array(),

  actorId: z.string(),
  accountId: z.string()
})
export type CreateAccessTokenParams = z.infer<typeof CreateAccessTokenParams>

export const UpdateRefreshTokenParams = z.object({
  accessToken: z.string(),

  refreshToken: z.string(),
  refreshTokenExpiresAt: z.number().nullish()
})
export type UpdateRefreshTokenParams = z.infer<typeof UpdateRefreshTokenParams>

export const RevokeAccessTokenParams = z.object({
  accessToken: z.string()
})
export type RevokeAccessTokenParams = z.infer<typeof RevokeAccessTokenParams>

export interface OAuthStorage {
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
}
