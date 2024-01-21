import { z } from 'zod'

import { OAuth2Application } from '@/lib/models/oauth2/application'

export const Scopes = z.enum(['read', 'write'])

export const RegisterApplicationparams = z.object({
  clientName: z.string(),
  redirectUris: z.string().array(),
  scopes: Scopes.array(),
  website: z.string().optional()
})
export type RegisterApplicationparams = z.infer<
  typeof RegisterApplicationparams
>

export interface OAuth2ApplicationStorage {
  registerApplication(
    params: RegisterApplicationparams
  ): Promise<OAuth2Application>
}
