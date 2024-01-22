import { z } from 'zod'

import { OAuth2Application } from '@/lib/models/oauth2/application'

export const Scopes = z.enum(['read', 'write'])

export const CreateApplicationparams = z.object({
  clientName: z.string(),
  redirectUris: z.string().array(),
  secret: z.string(),
  scopes: Scopes.array(),
  website: z.string().optional()
})
export type CreateApplicationparams = z.infer<typeof CreateApplicationparams>

export interface OAuth2ApplicationStorage {
  createApplication(
    params: CreateApplicationparams
  ): Promise<OAuth2Application | null>
}
