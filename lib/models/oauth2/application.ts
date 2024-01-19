import { z } from 'zod'

export const OAuth2Application = z.object({
  name: z.string(),
  uid: z.string(),
  secret: z.string(),
  redirectUri: z.string().array(),
  scopes: z.string().array(),

  ownerId: z.string(),
  ownerType: z.string(),

  credential: z.boolean().default(true),

  createdAt: z.number(),
  updatedAt: z.number()
})

export type OAuth2Application = z.infer<typeof OAuth2Application>
