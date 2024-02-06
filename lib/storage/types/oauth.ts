import { z } from 'zod'

import { Client } from '@/lib/models/oauth2/client'

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

export interface OAuthStorage {
  createClient(params: CreateClientParams): Promise<Client | null>
  getClientFromName(params: GetClientFromNameParams): Promise<Client | null>
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
  updateClient(params: UpdateClientParams): Promise<Client | null>
}
