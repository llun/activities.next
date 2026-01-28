// ActivityPub Actor types
import { z } from 'zod'

import { Emoji, HashTag, Image, PropertyValue } from './objects'

// APActor - ActivityPub Actor (Person, Service, etc.)
// Prefixed with "AP" to distinguish from domain Actor type
export const APActor = z.object({
  id: z.string(),
  type: z.union([
    z.literal('Person'),
    z.literal('Service'),
    z.literal('Application'),
    z.literal('Group'),
    z.literal('Organization')
  ]),
  following: z.string().url().optional(),
  followers: z.string().url().optional(),
  inbox: z.string().url(),
  outbox: z.string().url(),
  featured: z.string().url().optional(),
  featuredTags: z.string().url().optional(),
  preferredUsername: z.string(),
  name: z.string().optional(),
  summary: z.string().nullish(),
  url: z.string().optional(),
  published: z.string().nullish(),
  manuallyApprovesFollowers: z.boolean().optional(),
  discoverable: z.boolean().optional(),
  indexable: z.boolean().optional(),
  memorial: z.boolean().optional(),
  suspended: z.boolean().optional(),
  devices: z.string().url().optional(),
  alsoKnownAs: z.array(z.string()).optional(),
  movedTo: z.string().optional(),
  publicKey: z.object({
    id: z.string(),
    owner: z.string(),
    publicKeyPem: z.string()
  }),
  endpoints: z
    .object({
      sharedInbox: z.string().url().optional()
    })
    .optional(),
  icon: Image.nullish(),
  image: Image.nullish(),
  attachment: z.array(PropertyValue).optional(),
  tag: z.array(z.union([HashTag, Emoji])).optional(),
  generator: z
    .object({
      id: z.string().optional(),
      type: z.string(),
      name: z.string().optional(),
      url: z.string().optional()
    })
    .optional()
})
export type APActor = z.infer<typeof APActor>

// Convenience aliases
export const APPerson = APActor
export type APPerson = z.infer<typeof APPerson>

export const APService = APActor
export type APService = z.infer<typeof APService>

// Backward compatibility exports (keep old names)
export const Actor = APActor
export type Actor = z.infer<typeof Actor>

export const Person = APActor
export type Person = z.infer<typeof Person>

export const Service = APActor
export type Service = z.infer<typeof Service>
