// ActivityPub Actor types
import { z } from 'zod'

import { Emoji, HashTag, Image, PropertyValue } from './objects'

const ActorImage = z.union([Image, Image.array()])
const ActorCollectionReference = z.union([z.string().url(), z.looseObject({})])
const ActorUrl = z.union([z.string(), z.looseObject({})])
const ActorTag = z.union([Emoji, HashTag, z.looseObject({})])
const ActorAttachment = z.union([PropertyValue, z.looseObject({})])

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
  featured: ActorCollectionReference.optional(),
  featuredTags: ActorCollectionReference.optional(),
  // FEP-7aa9: collection of the actor's public FeaturedCollection objects.
  featuredCollections: ActorCollectionReference.optional(),
  preferredUsername: z.string(),
  name: z.string().optional(),
  summary: z.string().nullish(),
  url: z.union([ActorUrl, ActorUrl.array()]).optional(),
  published: z.string().nullish(),
  manuallyApprovesFollowers: z.boolean().optional(),
  discoverable: z.boolean().optional(),
  indexable: z.boolean().optional(),
  memorial: z.boolean().optional(),
  suspended: z.boolean().optional(),
  devices: z.string().url().optional(),
  // `alsoKnownAs` is a set of ids, but a single alias can arrive as a bare
  // string (JSON-LD compaction collapses a one-element set, and the raw-input
  // fallback preserves whatever the peer sent). Accept either shape and
  // normalise to an array so consumers see one consistent type.
  alsoKnownAs: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
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
  icon: ActorImage.nullish(),
  image: ActorImage.nullish(),
  attachment: z.union([ActorAttachment, ActorAttachment.array()]).optional(),
  tag: z.union([ActorTag, ActorTag.array()]).optional(),
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
