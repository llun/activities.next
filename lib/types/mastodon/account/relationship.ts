import { z } from 'zod'

/**
 * Represents the relationship between accounts in Mastodon, such as following, blocking, muting, etc.
 * @see https://docs.joinmastodon.org/entities/Relationship/
 */
export const Relationship = z.object({
  // The account ID (cast from integer but not guaranteed to be a number)
  id: z.string(),

  // Are you following this user?
  following: z.boolean(),

  // Are you receiving this user's boosts in your home timeline?
  showing_reblogs: z.boolean(),

  // Have you enabled notifications for this user?
  notifying: z.boolean(),

  // Which languages are you following from this user?
  languages: z.array(z.string()),

  // Are you followed by this user?
  followed_by: z.boolean(),

  // Are you blocking this user?
  blocking: z.boolean(),

  // Is this user blocking you?
  blocked_by: z.boolean(),

  // Are you muting this user?
  muting: z.boolean(),

  // Are you muting notifications from this user?
  muting_notifications: z.boolean(),

  // Do you have a pending follow request for this user?
  requested: z.boolean(),

  // Has this user requested to follow you?
  requested_by: z.boolean(),

  // Are you blocking this user's domain?
  domain_blocking: z.boolean(),

  // Are you featuring this user on your profile?
  endorsed: z.boolean(),

  // This user's profile bio
  note: z.string()
})

export type Relationship = z.infer<typeof Relationship>
