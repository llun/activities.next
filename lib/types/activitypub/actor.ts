// ActivityPub Actor types
import { z } from 'zod'

// Forward declarations - these will be resolved at runtime
// Importing from ./objects creates proper module resolution
const Image = z.object({
  type: z.literal('Image'),
  mediaType: z.string().nullish(),
  url: z.string()
})

const Emoji = z.object({
  type: z.literal('Emoji'),
  id: z.string().optional(),
  name: z.string(),
  updated: z.string(),
  icon: Image
})

const HashTag = z.object({
  type: z.literal('Hashtag'),
  href: z.string().url(),
  name: z.string().startsWith('#')
})

const PropertyValue = z.object({
  type: z.literal('PropertyValue'),
  name: z.string(),
  value: z.string()
})

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
