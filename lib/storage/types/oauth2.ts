import { z } from 'zod'

import { OAuth2Application } from '@/lib/models/oauth2/application'

export const Scopes = z.enum(['read', 'write', 'follow', 'push'])
export type Scopes = z.infer<typeof Scopes>

export const CreateApplicationParams = z.object({
  clientName: z.string(),
  redirectUris: z.string().array(),
  secret: z.string(),
  scopes: Scopes.array(),
  website: z.string().optional()
})
export type CreateApplicationParams = z.infer<typeof CreateApplicationParams>

export const GetApplicationParams = z.object({
  clientName: z.string()
})
export type GetApplicationParams = z.infer<typeof GetApplicationParams>

export interface OAuth2ApplicationStorage {
  createApplication(
    params: CreateApplicationParams
  ): Promise<OAuth2Application | null>
  getApplication(
    params: GetApplicationParams
  ): Promise<OAuth2Application | null>
}
