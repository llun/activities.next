import { z } from 'zod'

import { Account } from '@/lib/models/account'
import { logger } from '@/lib/utils/logger'

export const ActorProfile = z.object({
  id: z.string(),
  username: z.string(),
  domain: z.string(),
  name: z.string().optional(),
  summary: z.string().optional(),
  iconUrl: z.string().optional(),
  headerImageUrl: z.string().optional(),
  manuallyApprovesFollowers: z.boolean().optional(),

  followersUrl: z.string(),
  inboxUrl: z.string(),
  sharedInboxUrl: z.string(),

  followingCount: z.number(),
  followersCount: z.number(),

  statusCount: z.number(),
  lastStatusAt: z.number().nullable(),

  createdAt: z.number()
})

export type ActorProfile = z.infer<typeof ActorProfile>

export const Actor = ActorProfile.extend({
  privateKey: z.string().optional(),
  publicKey: z.string(),
  account: Account.optional(),
  updatedAt: z.number(),
  deletionStatus: z.enum(['scheduled', 'deleting']).nullable().optional(),
  deletionScheduledAt: z.number().nullable().optional()
})
export type Actor = z.infer<typeof Actor>

export const getActorProfile = (actor: Actor) => ActorProfile.parse(actor)

export const getMention = (actor: ActorProfile, withDomain = false) => {
  if (!withDomain) {
    return `@${actor.username}`
  }

  return `@${actor.username}@${actor.domain}`
}

export const getActorURL = (actor: Actor, withDomain = false) => {
  return `https://${actor.domain}/${getMention(actor, withDomain)}`
}

export const getMentionDomainFromActorID = (actorId: string) => {
  const url = new URL(actorId)
  return `@${url.hostname}`
}

export const getMentionFromActorID = (actorId: string, withDomain = false) => {
  try {
    // This method assume that all actor id has a username in the end,
    // however this might not be true especially for Misskey.io that use
    // random id in the actor id instead of username.
    const id = actorId.split('/').pop()
    if (!withDomain) {
      return `@${id}`
    }

    return `@${id}${getMentionDomainFromActorID(actorId)}`
  } catch {
    logger.error(`Fail to split the actor id, (${JSON.stringify(actorId)})`)
    return actorId
  }
}
