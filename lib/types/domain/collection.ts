import { z } from 'zod'

// Visibility of a collection. 'public' appears on the owner's profile and is
// link-shareable; 'unlisted' is link-shareable but not surfaced on the profile;
// 'private' is owner-only (behaves like a List with no public projection).
export const CollectionVisibility = z.enum(['public', 'unlisted', 'private'])
export type CollectionVisibility = z.infer<typeof CollectionVisibility>

// Per-member public-exposure consent. Membership always includes the member in
// the owner's private feed; this state only gates the PUBLIC projection.
//  - 'pending'  : added by the curator, member has not approved yet
//  - 'approved' : member consented (requires the actor's allowFeaturing opt-in)
//  - 'revoked'  : member opted out; hidden from the public projection
export const CollectionFeatureState = z.enum(['pending', 'approved', 'revoked'])
export type CollectionFeatureState = z.infer<typeof CollectionFeatureState>

export const Collection = z.object({
  id: z.string(),
  ownerActorId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  topic: z.string().nullable(),
  language: z.string().nullable(),
  visibility: CollectionVisibility,
  publicFeed: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Collection = z.infer<typeof Collection>
