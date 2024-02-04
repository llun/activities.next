import { z } from 'zod'

import { OAuth2Application } from '@/lib/models/oauth2/application'

export const Scopes = z.enum(['read', 'write', 'follow', 'push'])
export type Scopes = z.infer<typeof Scopes>

export const CreateApplicationParams = z.object({
  name: z.string(),
  redirectUris: z.string().array(),
  secret: z.string(),
  scopes: Scopes.array(),
  website: z.string().optional()
})
export type CreateApplicationParams = z.infer<typeof CreateApplicationParams>

export const GetApplicationFromNameParams = z.object({
  name: z.string()
})
export type GetApplicationFromNameParams = z.infer<
  typeof GetApplicationFromNameParams
>

export const GetApplicationFromIdParams = z.object({
  clientId: z.string()
})
export type GetApplicationFromIdParams = z.infer<
  typeof GetApplicationFromIdParams
>

export const UpdateApplicationParams = CreateApplicationParams.extend({
  id: z.string()
})
export type UpdateApplicationParams = z.infer<typeof UpdateApplicationParams>

export interface OAuth2ApplicationStorage {
  createApplication(
    params: CreateApplicationParams
  ): Promise<OAuth2Application | null>
  getApplicationFromName(
    params: GetApplicationFromNameParams
  ): Promise<OAuth2Application | null>
  getApplicationFromId(
    params: GetApplicationFromIdParams
  ): Promise<OAuth2Application | null>
  updateApplication(
    params: UpdateApplicationParams
  ): Promise<OAuth2Application | null>
}
